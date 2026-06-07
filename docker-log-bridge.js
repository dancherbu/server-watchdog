'use strict';
/**
 * docker-log-bridge.js
 * Tails `docker logs -f <container>` and appends output to a host log file.
 * Run as a PM2 process alongside server-watchdog.
 *
 * PM2 start:
 *   pm2 start ~/.server-watchdog/docker-log-bridge.js \
 *     --name ccomi-log-bridge \
 *     --restart-delay 5000
 */

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const CONTAINER = process.env.WATCHDOG_DOCKER_CONTAINER || 'ccomi-backend';
const LOG_FILE  = process.env.BRIDGE_LOG_FILE || '/var/log/ccomi/error.log';

// Ensure log directory exists
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

function timestamp() {
  return new Date().toISOString();
}

function log(msg) {
  console.log(`[${timestamp()}] [log-bridge] ${msg}`);
}

function startTail() {
  log(`Tailing docker logs for container: ${CONTAINER} → ${LOG_FILE}`);

  const proc = spawn('docker', ['logs', '-f', '--since', '1m', CONTAINER], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

  proc.stdout.on('data', (data) => stream.write(data));
  proc.stderr.on('data', (data) => stream.write(data));

  proc.on('error', (err) => {
    log(`Error spawning docker logs: ${err.message}`);
  });

  proc.on('close', (code) => {
    log(`docker logs exited (code ${code}) — restarting in 5s...`);
    stream.end();
    setTimeout(startTail, 5000);
  });
}

log(`Starting docker log bridge for ${CONTAINER}`);
startTail();

process.on('SIGINT',  () => { log('SIGINT — exiting'); process.exit(0); });
process.on('SIGTERM', () => { log('SIGTERM — exiting'); process.exit(0); });
