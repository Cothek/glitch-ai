// scripts/lib/vision-logger.mjs
// Vision Dispatch Compliance Logger
// Tracks when images are detected and dispatched to @vision
// Format: [YYYY-MM-DD HH:MM:SS] ACTION: details

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log file path: data/vision-dispatch-log.txt (relative to project root)
// Project root is 3 levels up from scripts/lib/vision-logger.mjs
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const LOG_FILE = path.join(PROJECT_ROOT, 'data', 'vision-dispatch-log.txt');

/**
 * Format a timestamp as [YYYY-MM-DD HH:MM:SS]
 * @param {Date} [date] - Date to format (defaults to now)
 * @returns {string} Formatted timestamp
 */
function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `[${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}]`;
}

/**
 * Append a single entry to the log file.
 * @param {string} action - One of DETECTED, DISPATCHED, COMPLETED, DELETED, ERROR
 * @param {string} details - Details string to append after the action
 */
async function appendEntry(action, details) {
  const line = `${formatTimestamp()} ${action}: ${details}\n`;
  try {
    await fs.appendFile(LOG_FILE, line, 'utf8');
  } catch (err) {
    // Last-resort fallback: write to stderr so the failure is at least visible
    process.stderr.write(`[vision-logger] Failed to write log entry: ${err.message}\n`);
  }
}

/**
 * Log when NEW_IMAGE_FLAG is found.
 * @param {string} imagePath - Absolute path to the detected image
 */
export async function logVisionDetection(imagePath) {
  await appendEntry('DETECTED', imagePath);
}

/**
 * Log when @vision is dispatched.
 * @param {string} taskId - Task / session ID returned by the dispatch
 */
export async function logVisionDispatch(taskId) {
  await appendEntry('DISPATCHED', taskId);
}

/**
 * Log when @vision returns.
 * @param {string} taskId - Task / session ID that completed
 * @param {boolean} success - Whether the dispatch succeeded
 */
export async function logVisionCompletion(taskId, success) {
  const status = success ? 'success' : 'failure';
  await appendEntry('COMPLETED', `${taskId} (${status})`);
}

/**
 * Log when the NEW_IMAGE_FLAG file is deleted.
 */
export async function logVisionDeletion() {
  await appendEntry('DELETED', 'NEW_IMAGE_FLAG removed');
}

/**
 * Log any error encountered in the vision dispatch pipeline.
 * @param {string|Error} error - Error message or Error instance
 */
export async function logVisionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  await appendEntry('ERROR', message);
}

/**
 * Read the log file and return counts of each action type.
 * @returns {Promise<{DETECTED: number, DISPATCHED: number, COMPLETED: number, DELETED: number, ERROR: number, total: number}>}
 */
export async function getVisionLogStats() {
  const stats = {
    DETECTED: 0,
    DISPATCHED: 0,
    COMPLETED: 0,
    DELETED: 0,
    ERROR: 0,
    total: 0,
  };

  let content;
  try {
    content = await fs.readFile(LOG_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return stats;
    }
    throw err;
  }

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    // Skip blank lines and comment lines
    if (!line || line.startsWith('#')) continue;
    // Match lines like "[2026-07-28 12:34:56] DETECTED: ..."
    const match = line.match(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] ([A-Z]+):/);
    if (!match) continue;
    const action = match[1];
    if (Object.prototype.hasOwnProperty.call(stats, action)) {
      stats[action] += 1;
      stats.total += 1;
    }
  }

  return stats;
}

// Export the log file path for tests / external use
export const VISION_LOG_FILE = LOG_FILE;
