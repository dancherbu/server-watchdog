'use strict';
/**
 * classifier.js — extracts and deduplicates errors from log lines.
 *
 * Responsibilities:
 *  - Parse error patterns from raw log text (Node.js, Python, generic)
 *  - Deduplicate within a time window
 *  - Identify dominant error vs. cascading secondaries
 *  - Return a structured payload for the AI agent
 */

// ── Error patterns ────────────────────────────────────────────────────
// Each pattern: { code, regex, extractFile, extractLine }
const PATTERNS = [
  // MySQL / mariadb error codes
  {
    code: 'ER_BAD_FIELD_ERROR',
    regex: /ER_BAD_FIELD_ERROR[:\s]/,
    severity: 'fixable',
  },
  {
    code: 'ER_NO_SUCH_TABLE',
    regex: /ER_NO_SUCH_TABLE[:\s]/,
    severity: 'fixable',
  },
  {
    code: 'ER_PARSE_ERROR',
    regex: /ER_PARSE_ERROR[:\s]/,
    severity: 'fixable',
  },
  {
    code: 'ER_ACCESS_DENIED_ERROR',
    regex: /ER_ACCESS_DENIED/,
    severity: 'infrastructure', // do NOT attempt to fix
  },
  // Node.js runtime errors
  {
    code: 'TypeError',
    regex: /TypeError:/,
    severity: 'fixable',
  },
  {
    code: 'ReferenceError',
    regex: /ReferenceError:/,
    severity: 'fixable',
  },
  {
    code: 'SyntaxError',
    regex: /SyntaxError:/,
    severity: 'fixable',
  },
  {
    code: 'UnhandledPromiseRejection',
    regex: /UnhandledPromiseRejection|unhandledRejection/,
    severity: 'fixable',
  },
  // Infrastructure — watchdog should alert but NOT attempt to fix
  {
    code: 'ECONNREFUSED',
    regex: /ECONNREFUSED/,
    severity: 'infrastructure',
  },
  {
    code: 'ENOTFOUND',
    regex: /ENOTFOUND/,
    severity: 'infrastructure',
  },
  {
    code: 'ENOMEM',
    regex: /ENOMEM|JavaScript heap out of memory/,
    severity: 'infrastructure',
  },
];

// Extract the first file:line from a stack trace block
function extractOrigin(block) {
  // Match: at Something (/abs/path/file.js:42:10) or at file.js:42
  const match = block.match(/at\s+(?:\S+ \()?([^\s(]+\.(?:js|ts|py|rb|go)):(\d+)/);
  if (!match) return null;
  return { file: match[1], line: parseInt(match[2], 10) };
}

// Extract error message text
function extractMessage(block, code) {
  const match = block.match(new RegExp(`${code}[^\\n]*`));
  return match ? match[0].trim().slice(0, 300) : '';
}

/**
 * classify(logText)
 * Takes a chunk of log text and returns an array of detected error events.
 * Each event: { code, severity, message, origin, raw, detectedAt }
 */
function classify(logText) {
  const events = [];

  // Split into blocks by newline sequences that look like error boundaries
  // Simple heuristic: split on lines that start a new error keyword
  const lines = logText.split('\n');
  let currentBlock = '';

  for (const line of lines) {
    const isErrorStart = PATTERNS.some(p => p.regex.test(line));
    if (isErrorStart && currentBlock) {
      processBlock(currentBlock, events);
      currentBlock = line + '\n';
    } else {
      currentBlock += line + '\n';
    }
  }
  if (currentBlock) processBlock(currentBlock, events);

  return events;
}

function processBlock(block, events) {
  for (const pattern of PATTERNS) {
    if (!pattern.regex.test(block)) continue;

    const origin = extractOrigin(block);
    const message = extractMessage(block, pattern.code);

    events.push({
      code:        pattern.code,
      severity:    pattern.severity,
      message,
      origin,       // { file, line } or null
      raw:          block.trim().slice(0, 1000),
      detectedAt:   Date.now(),
    });
    break; // one classification per block
  }
}

/**
 * aggregate(events)
 * Collapses a burst of events into a single payload for the AI agent.
 *
 * Returns:
 * {
 *   dominantError: { code, severity, message, origin, occurrences },
 *   secondaryErrors: [...],
 *   totalEvents: number,
 *   windowMs: number,
 *   fixable: boolean,
 * }
 */
function aggregate(events) {
  if (!events.length) return null;

  // Count occurrences per error code
  const counts = {};
  const samples = {};
  for (const ev of events) {
    counts[ev.code]  = (counts[ev.code]  || 0) + 1;
    samples[ev.code] = samples[ev.code] || ev; // keep first sample
  }

  // Find dominant (most frequent)
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [dominantCode, dominantCount] = sorted[0];
  const dominantSample = samples[dominantCode];

  const dominant = {
    code:        dominantCode,
    severity:    dominantSample.severity,
    message:     dominantSample.message,
    origin:      dominantSample.origin,
    raw:         dominantSample.raw,
    occurrences: dominantCount,
  };

  const secondaries = sorted.slice(1).map(([code, count]) => ({
    code,
    severity:    samples[code].severity,
    message:     samples[code].message,
    origin:      samples[code].origin,
    occurrences: count,
  }));

  const windowMs = events.length > 1
    ? events[events.length - 1].detectedAt - events[0].detectedAt
    : 0;

  return {
    dominantError:   dominant,
    secondaryErrors: secondaries,
    totalEvents:     events.length,
    windowMs,
    fixable:         dominant.severity === 'fixable',
  };
}

module.exports = { classify, aggregate, PATTERNS };
