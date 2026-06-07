'use strict';
/**
 * config.js — reads all configuration from .env.watchdog
 * All other modules import from here. Never read process.env directly elsewhere.
 */

const path = require('path');
const fs   = require('fs');

// Load .env.watchdog from the watchdog install directory
const envFile = path.resolve(__dirname, '.env.watchdog');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val; // don't override shell env
  }
}

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`[config] Missing required config: ${key}. Set it in .env.watchdog`);
  return val;
}

function optional(key, defaultVal) {
  return process.env[key] || defaultVal;
}

function optionalInt(key, defaultVal) {
  const val = process.env[key];
  if (!val) return defaultVal;
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new Error(`[config] ${key} must be an integer, got: ${val}`);
  return n;
}

function optionalFloat(key, defaultVal) {
  const val = process.env[key];
  if (!val) return defaultVal;
  const n = parseFloat(val);
  if (isNaN(n)) throw new Error(`[config] ${key} must be a number, got: ${val}`);
  return n;
}

function optionalBool(key, defaultVal) {
  const val = process.env[key];
  if (!val) return defaultVal;
  return val.toLowerCase() === 'true';
}

const config = {
  // ── Target project ────────────────────────────────────────────────
  projectRoot:  required('WATCHDOG_PROJECT_ROOT'),
  logPath:      required('WATCHDOG_LOG_PATH'),

  // ── Git ──────────────────────────────────────────────────────────
  gitBranch:            optional('WATCHDOG_GIT_BRANCH', 'main'),
  gitFixBranchPrefix:   optional('WATCHDOG_GIT_FIX_BRANCH_PREFIX', 'ai-fix'),
  gitRemote:            optional('WATCHDOG_GIT_REMOTE', 'origin'),

  // ── AI Agent ─────────────────────────────────────────────────────
  geminiApiKey:         required('GEMINI_API_KEY'),
  aiFixModel:           optional('AI_FIX_MODEL', 'gemini-2.5-flash'),
  aiCommitThreshold:    optionalFloat('AI_FIX_COMMIT_THRESHOLD', 0.80),
  aiMaxRetries:         optionalInt('AI_FIX_MAX_RETRIES', 2),
  aiAutodeploy:         optionalBool('AI_FIX_AUTODEPLOY', false),

  // ── Timing ───────────────────────────────────────────────────────
  pollMs:          optionalInt('WATCHDOG_POLL_MS', 60_000),
  dedupWindowMs:   optionalInt('WATCHDOG_DEDUP_WINDOW_MS', 60_000),
  cooldownMs:      optionalInt('WATCHDOG_COOLDOWN_MS', 300_000),
  respawnDelayMs:  optionalInt('WATCHDOG_RESPAWN_DELAY_MS', 5_000),

  // ── Process manager ──────────────────────────────────────────────
  restartMode:            optional('WATCHDOG_RESTART_MODE', 'pm2'),
  pm2AppName:             optional('WATCHDOG_PM2_APP_NAME', ''),
  systemdService:         optional('WATCHDOG_SYSTEMD_SERVICE', ''),
  dockerContainer:        optional('WATCHDOG_DOCKER_CONTAINER', ''),
  dockerComposeFile:      optional('WATCHDOG_DOCKER_COMPOSE_FILE', ''),
  dockerComposeService:   optional('WATCHDOG_DOCKER_COMPOSE_SERVICE', ''),

  // ── Health verification ───────────────────────────────────────────
  healthUrl:        optional('WATCHDOG_HEALTH_URL', ''),
  healthTimeoutMs:  optionalInt('WATCHDOG_HEALTH_TIMEOUT_MS', 15_000),
  healthRetries:    optionalInt('WATCHDOG_HEALTH_RETRIES', 3),

  // ── Project-specific AI knowledge ────────────────────────────────
  agentMd:      optional('WATCHDOG_AGENT_MD', ''),
  extraSkills:  optional('WATCHDOG_EXTRA_SKILLS', ''),

  // ── Notifications ────────────────────────────────────────────────
  notifyWebhook: optional('WATCHDOG_NOTIFY_WEBHOOK', ''),

  // ── Test execution ───────────────────────────────────────────────
  testTimeoutMs:  optionalInt('WATCHDOG_TEST_TIMEOUT_MS', 30_000),
  commitTests:    optionalBool('WATCHDOG_COMMIT_TESTS', true),

  // ── Internal paths ───────────────────────────────────────────────
  watchdogDir: __dirname,
  venvPython:  path.join(__dirname, 'ai_fix_agent', '.venv', 'bin', 'python'),
  agentScript: path.join(__dirname, 'ai_fix_agent', 'agent.py'),
  logsDir:     path.join(__dirname, 'logs'),
};

// Validate process manager config
const modeRequirements = {
  pm2:            () => { if (!config.pm2AppName)           throw new Error('[config] WATCHDOG_PM2_APP_NAME required when RESTART_MODE=pm2'); },
  systemd:        () => { if (!config.systemdService)       throw new Error('[config] WATCHDOG_SYSTEMD_SERVICE required when RESTART_MODE=systemd'); },
  docker:         () => { if (!config.dockerContainer)      throw new Error('[config] WATCHDOG_DOCKER_CONTAINER required when RESTART_MODE=docker'); },
  'docker-compose': () => { if (!config.dockerComposeFile || !config.dockerComposeService) throw new Error('[config] WATCHDOG_DOCKER_COMPOSE_FILE and WATCHDOG_DOCKER_COMPOSE_SERVICE required when RESTART_MODE=docker-compose'); },
};

if (modeRequirements[config.restartMode]) {
  modeRequirements[config.restartMode]();
} else {
  throw new Error(`[config] Unknown WATCHDOG_RESTART_MODE: ${config.restartMode}. Must be: pm2 | systemd | docker | docker-compose`);
}

// Ensure logs dir exists
if (!fs.existsSync(config.logsDir)) fs.mkdirSync(config.logsDir, { recursive: true });

module.exports = config;
