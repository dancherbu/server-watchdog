'use strict';
/**
 * restarter.js — restarts the backend process and verifies health.
 *
 * restart(config) → Promise<{ ok: boolean, error?: string }>
 *
 * Supports: pm2 | systemd | docker | docker-compose
 * Always follows restart with a health check against WATCHDOG_HEALTH_URL.
 * If health fails after WATCHDOG_HEALTH_RETRIES attempts, returns ok: false.
 */

const { exec }  = require('child_process');
const http      = require('http');
const https     = require('https');
const util      = require('util');

const execAsync = util.promisify(exec);

// ── Restart commands ──────────────────────────────────────────────────
function buildRestartCommand(config) {
  switch (config.restartMode) {
    case 'pm2':
      return `pm2 restart ${config.pm2AppName}`;
    case 'systemd':
      return `sudo systemctl restart ${config.systemdService}`;
    case 'docker':
      return `docker restart ${config.dockerContainer}`;
    case 'docker-compose':
      return `docker compose -f ${config.dockerComposeFile} restart ${config.dockerComposeService}`;
    default:
      throw new Error(`Unknown WATCHDOG_RESTART_MODE: ${config.restartMode}`);
  }
}

// ── Health check ──────────────────────────────────────────────────────
function httpGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode, body });
        } else {
          reject(new Error(`Health check returned HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Health check timed out')); });
    req.on('error', reject);
  });
}

async function waitForHealth(config) {
  if (!config.healthUrl) {
    // No health URL configured — wait 3s and assume ok
    await new Promise(r => setTimeout(r, 3000));
    return { ok: true, note: 'no health URL configured' };
  }

  const perAttemptMs = Math.floor(config.healthTimeoutMs / config.healthRetries);

  for (let attempt = 1; attempt <= config.healthRetries; attempt++) {
    try {
      await httpGet(config.healthUrl, perAttemptMs);
      return { ok: true };
    } catch (err) {
      const isLast = attempt === config.healthRetries;
      if (isLast) return { ok: false, error: err.message };
      // Wait before retry — exponential backoff
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────
/**
 * restart(config)
 * Restarts the backend and verifies the health endpoint.
 * Returns { ok: true } on success or { ok: false, error: string } on failure.
 */
async function restart(config) {
  const cmd = buildRestartCommand(config);

  try {
    await execAsync(cmd, { timeout: 30_000 });
  } catch (err) {
    return { ok: false, error: `Restart command failed: ${err.message}` };
  }

  // Give the process a moment to initialise before hitting health
  const warmupMs = Math.min(config.healthTimeoutMs * 0.2, 3000);
  await new Promise(r => setTimeout(r, warmupMs));

  const health = await waitForHealth(config);
  return health;
}

module.exports = { restart, waitForHealth };
