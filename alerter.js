'use strict';
/**
 * alerter.js — sends notifications on fix events.
 * Supports: Slack/Discord/generic webhook (POST JSON).
 * Extend this file to add email, PagerDuty, etc.
 */

const https = require('https');
const http  = require('http');
const url   = require('url');

/**
 * sendAlert(config, payload)
 * payload: {
 *   event:    'FIX_APPLIED' | 'FIX_FAILED' | 'FIX_SKIPPED' | 'INFRASTRUCTURE_ERROR',
 *   error:    aggregated error object (dominantError, totalEvents, ...),
 *   result?:  agent result (branch, confidence, filesChanged),
 *   reason?:  string — why it was skipped/failed
 * }
 */
async function sendAlert(config, payload) {
  if (!config.notifyWebhook) return; // no webhook configured

  const message = buildMessage(payload);

  try {
    await post(config.notifyWebhook, {
      text: message,            // Slack plain text fallback
      content: message,         // Discord
      message,                  // generic
      payload,                  // full machine-readable payload
    });
  } catch (err) {
    // Never let alerter errors crash the watchdog
    console.error(`[alerter] Webhook delivery failed: ${err.message}`);
  }
}

function buildMessage(payload) {
  const { event, error, result, reason } = payload;
  const dominant = error?.dominantError;
  const origin   = dominant?.origin
    ? `${dominant.origin.file}:${dominant.origin.line}`
    : 'unknown location';

  switch (event) {
    case 'FIX_APPLIED':
      return [
        `✅ *AI Fix Applied* — \`${dominant?.code}\``,
        `📍 Origin: \`${origin}\` (${error?.totalEvents} occurrences)`,
        `🌿 Branch: \`${result?.branch}\`  |  Confidence: ${(result?.confidence * 100).toFixed(0)}%`,
        `📄 Files: ${result?.filesChanged?.join(', ') || 'unknown'}`,
        `🔄 Server restarted and health check passed.`,
        `→ Review and merge: ${result?.branch}`,
      ].join('\n');

    case 'FIX_FAILED':
      return [
        `❌ *AI Fix FAILED* — \`${dominant?.code}\``,
        `📍 Origin: \`${origin}\``,
        `⚠️  Reason: ${reason || 'unknown'}`,
        `🔄 Original files restored. Server restarted.`,
        `→ Manual review required.`,
      ].join('\n');

    case 'FIX_SKIPPED':
      return [
        `⏭️  *Fix Skipped* — \`${dominant?.code}\``,
        `Reason: ${reason || 'confidence below threshold or error on cooldown'}`,
      ].join('\n');

    case 'INFRASTRUCTURE_ERROR':
      return [
        `🚨 *Infrastructure Error* — \`${dominant?.code}\``,
        `📍 Origin: \`${origin}\``,
        `This error cannot be auto-fixed. Manual intervention required.`,
      ].join('\n');

    default:
      return `[server-watchdog] ${event}: ${dominant?.code || 'unknown error'}`;
  }
}

function post(webhookUrl, body) {
  return new Promise((resolve, reject) => {
    const parsed  = url.parse(webhookUrl);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const data    = JSON.stringify(body);

    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port,
      path:     parsed.path,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent':     'server-watchdog/0.1',
      },
      timeout: 10_000,
    }, (res) => {
      res.resume(); // consume response
      if (res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error(`Webhook returned ${res.statusCode}`));
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Webhook request timed out')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = { sendAlert };
