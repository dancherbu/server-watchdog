'use strict';
/**
 * watchdog.js — main entry point.
 *
 * Polls the configured error log on a fixed interval.
 * When errors are detected:
 *   1. Classifies and deduplicates them
 *   2. Checks cooldowns (skip if same error was fixed recently)
 *   3. Spawns the AI fix agent for fixable errors
 *   4. Applies fix, restarts server, verifies health
 *   5. Rolls back if health check fails
 *   6. Sends notifications at each stage
 */

const fs      = require('fs');
const path    = require('path');
const { spawnSync } = require('child_process');

const config     = require('./config');
const { classify, aggregate } = require('./classifier');
const { restart }  = require('./restarter');
const { sendAlert } = require('./alerter');

// ── Logger ────────────────────────────────────────────────────────────
function log(level, msg, extra) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [watchdog] [${level}] ${msg}`;
  console.log(line);
  if (extra) console.log(JSON.stringify(extra, null, 2));
}

// ── State ─────────────────────────────────────────────────────────────
let lastReadPosition = 0;  // byte offset in log file — only read new lines
const cooldowns = new Map(); // errorCode → timestamp when cooldown expires

function isOnCooldown(code) {
  const expires = cooldowns.get(code);
  if (!expires) return false;
  if (Date.now() < expires) return true;
  cooldowns.delete(code);
  return false;
}

function setCooldown(code) {
  cooldowns.set(code, Date.now() + config.cooldownMs);
}

// ── Log reading ───────────────────────────────────────────────────────
function readNewLogLines() {
  if (!fs.existsSync(config.logPath)) return '';

  const stat = fs.statSync(config.logPath);
  const fileSize = stat.size;

  // Handle log rotation (file got smaller)
  if (fileSize < lastReadPosition) {
    log('INFO', 'Log file rotated — resetting read position');
    lastReadPosition = 0;
  }

  if (fileSize === lastReadPosition) return '';

  const fd = fs.openSync(config.logPath, 'r');
  const length = fileSize - lastReadPosition;
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, lastReadPosition);
  fs.closeSync(fd);

  lastReadPosition = fileSize;
  return buffer.toString('utf8');
}

// ── AI Agent invocation ───────────────────────────────────────────────
function runAiAgent(aggregated) {
  const pythonBin = fs.existsSync(config.venvPython) ? config.venvPython : 'python3';

  const errorJson = JSON.stringify(aggregated);
  const envFile   = path.join(config.watchdogDir, '.env.watchdog');

  log('INFO', '🤖 Spawning AI fix agent...', {
    dominant: aggregated.dominantError?.code,
    occurrences: aggregated.totalEvents,
  });

  const result = spawnSync(pythonBin, [
    config.agentScript,
    '--project-root', config.projectRoot,
    '--error-json',   errorJson,
    '--env-file',     envFile,
  ], {
    timeout: 300_000, // 5 min max for agent
    encoding: 'utf8',
    cwd: config.projectRoot,
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  // Agent writes JSON result to stdout on last line
  const lines = (result.stdout || '').trim().split('\n').filter(Boolean);
  const lastLine = lines[lines.length - 1] || '';

  try {
    const parsed = JSON.parse(lastLine);
    return { ok: result.status === 0, ...parsed };
  } catch {
    return {
      ok: result.status === 0,
      raw_stdout: result.stdout?.slice(-2000),
      raw_stderr: result.stderr?.slice(-2000),
    };
  }
}

// ── Rollback ──────────────────────────────────────────────────────────
function rollback(agentResult) {
  if (!agentResult?.filesBackedUp?.length) return;

  log('WARN', '🔄 Rolling back patched files...');

  for (const { original, backup } of agentResult.filesBackedUp) {
    try {
      fs.copyFileSync(backup, original);
      fs.unlinkSync(backup);
      log('INFO', `  Restored: ${original}`);
    } catch (err) {
      log('ERROR', `  Rollback failed for ${original}: ${err.message}`);
    }
  }
}

// ── Main fix cycle ────────────────────────────────────────────────────
async function handleErrors(aggregated) {
  const { dominantError, fixable } = aggregated;
  const code = dominantError.code;

  // Infrastructure errors — alert only
  if (!fixable) {
    log('WARN', `🚨 Infrastructure error detected: ${code} — alerting, not fixing`);
    await sendAlert(config, { event: 'INFRASTRUCTURE_ERROR', error: aggregated });
    return;
  }

  // Cooldown check
  if (isOnCooldown(code)) {
    log('INFO', `⏭️  ${code} is on cooldown — skipping`);
    return;
  }

  // Run AI agent
  const agentResult = runAiAgent(aggregated);

  // ── Agent did not commit (low confidence or unfixable) ────────────
  if (!agentResult.ok || !agentResult.committed) {
    log('WARN', `🤷 AI agent did not commit a fix for ${code}`, agentResult);
    await sendAlert(config, {
      event: 'FIX_SKIPPED',
      error: aggregated,
      reason: agentResult.reason || 'confidence below threshold or agent error',
    });
    setCooldown(code);
    return;
  }

  log('INFO', `✅ Fix committed to branch: ${agentResult.branch}`);

  // ── Restart server ────────────────────────────────────────────────
  log('INFO', `🔄 Restarting server (${config.restartMode})...`);
  const health = await restart(config);

  if (health.ok) {
    log('INFO', '✅ Server healthy after restart');
    await sendAlert(config, { event: 'FIX_APPLIED', error: aggregated, result: agentResult });
    setCooldown(code);
    return;
  }

  // ── Health failed — rollback ──────────────────────────────────────
  log('ERROR', `❌ Health check failed after fix: ${health.error}`);
  log('WARN', '🔄 Rolling back...');

  rollback(agentResult);

  const recoveryHealth = await restart(config);
  if (!recoveryHealth.ok) {
    log('ERROR', '💀 CRITICAL: Server did not recover after rollback. Manual intervention required.');
  } else {
    log('INFO', '✅ Server recovered after rollback');
  }

  await sendAlert(config, {
    event: 'FIX_FAILED',
    error: aggregated,
    result: agentResult,
    reason: health.error,
  });

  setCooldown(code);
}

// ── Poll loop ─────────────────────────────────────────────────────────
async function poll() {
  const newText = readNewLogLines();
  if (!newText.trim()) return;

  const events = classify(newText);
  if (!events.length) return;

  const aggregated = aggregate(events);
  if (!aggregated) return;

  log('INFO', `🔍 Detected ${aggregated.totalEvents} error(s) — dominant: ${aggregated.dominantError.code}`, {
    occurrences: aggregated.dominantError.occurrences,
    secondary:   aggregated.secondaryErrors.map(e => e.code),
    fixable:     aggregated.fixable,
  });

  await handleErrors(aggregated);
}

// ── Entry point ───────────────────────────────────────────────────────
log('INFO', `🚀 Watchdog started`, {
  mode:        config.restartMode,
  pollMs:      config.pollMs,
  logPath:     config.logPath,
  projectRoot: config.projectRoot,
});
log('INFO', `Watching log file: ${config.logPath}`);

// Seek to end of log on startup — only watch NEW errors
if (fs.existsSync(config.logPath)) {
  lastReadPosition = fs.statSync(config.logPath).size;
  log('INFO', `Seeked to end of log (${lastReadPosition} bytes) — watching for new entries`);
}

// Run poll loop
setInterval(async () => {
  try {
    await poll();
  } catch (err) {
    log('ERROR', `Poll cycle error: ${err.message}`, { stack: err.stack });
  }
}, config.pollMs);

// Graceful shutdown
process.on('SIGINT',  () => { log('INFO', 'Watchdog received SIGINT — shutting down'); process.exit(0); });
process.on('SIGTERM', () => { log('INFO', 'Watchdog received SIGTERM — shutting down'); process.exit(0); });
