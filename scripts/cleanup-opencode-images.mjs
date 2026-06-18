#!/usr/bin/env node
/**
 * opencode Image Garbage Collection
 *
 * Removes image parts from sessions older than a threshold
 * to reclaim storage space in the opencode SQLite database.
 *
 * Usage:
 *   node scripts/cleanup-opencode-images.mjs          # dry-run (default)
 *   node scripts/cleanup-opencode-images.mjs --apply   # actually delete
 *   node scripts/cleanup-opencode-images.mjs --days 90 # custom threshold
 *   node scripts/cleanup-opencode-images.mjs --stats   # just show stats
 *
 * The `--apply` flag is required to actually DELETE data.
 * Without it, the script only reports what it would remove.
 */

import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, existsSync, writeFileSync } from 'fs';

// ── Config ─────────────────────────────────────────────────────────────────
const DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
const DEFAULT_DAYS = 90; // 3 months
const LAST_RUN_PATH = join(homedir(), '.local', 'share', 'opencode', '.image-gc-last-run');

// ── Parse args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isApply = args.includes('--apply');
const isStats = args.includes('--stats');
const daysFlag = args.find(a => a.startsWith('--days='));
const thresholdDays = daysFlag ? parseInt(daysFlag.split('=')[1], 10) : DEFAULT_DAYS;
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  console.log(`
  opencode Image Garbage Collection

  Removes image parts from sessions older than the threshold
  to reclaim storage in the opencode SQLite database.

  Options:
    --apply        Actually delete the data (default: dry-run)
    --days=N       Age threshold in days (default: 90)
    --stats        Just show image storage stats, no action
    --help, -h     Show this help

  Examples:
    node scripts/cleanup-opencode-images.mjs              # dry-run report
    node scripts/cleanup-opencode-images.mjs --apply       # delete old images
    node scripts/cleanup-opencode-images.mjs --days=60     # 2-month threshold
    node scripts/cleanup-opencode-images.mjs --stats       # storage overview
  `);
  process.exit(0);
}

// ── DB connection ──────────────────────────────────────────────────────────
if (!existsSync(DB_PATH)) {
  console.error(`Error: Database not found at ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);

// Verify DB has the expected schema
try {
  db.prepare("SELECT 1 FROM part LIMIT 1").get();
} catch {
  console.error('Error: part table not found — is this the right database?');
  db.close();
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

function formatDate(ms) {
  return new Date(ms).toISOString().split('T')[0];
}

const now = Date.now();
const cutoffMs = now - thresholdDays * 24 * 60 * 60 * 1000;

// ── Stats Mode ─────────────────────────────────────────────────────────────
if (isStats) {
  console.log('── opencode Image Storage Stats ──');
  console.log(`  Database: ${DB_PATH}`);
  console.log(`  DB size:  ${formatBytes(existsSync(DB_PATH) ? (await import('fs')).statSync(DB_PATH).size : 0)}`);
  console.log('');

  const totalImages = db.prepare(`
    SELECT COUNT(*) as cnt, SUM(LENGTH(data)) as bytes
    FROM part WHERE json_extract(data, '$.mime') LIKE 'image/%'
  `).get();
  console.log(`  Total image parts: ${totalImages.cnt}`);
  console.log(`  Total image size:  ${formatBytes(totalImages.bytes || 0)}`);
  console.log('');

  // By mime type
  const byMime = db.prepare(`
    SELECT json_extract(data, '$.mime') as mime,
           COUNT(*) as cnt,
           SUM(LENGTH(data)) as bytes
    FROM part WHERE json_extract(data, '$.mime') LIKE 'image/%'
    GROUP BY mime ORDER BY cnt DESC
  `).all();
  console.log('  By mime type:');
  for (const r of byMime) {
    console.log(`    ${r.mime || 'unknown'}: ${r.cnt} parts, ${formatBytes(r.bytes || 0)}`);
  }
  console.log('');

  // By session age
  console.log('  By session age:');
  const ageBuckets = [
    { label: 'under 30 days', cutoff: now - 30 * 24 * 60 * 60 * 1000 },
    { label: '30-60 days',    cutoff: now - 60 * 24 * 60 * 60 * 1000 },
    { label: '60-90 days',    cutoff: now - 90 * 24 * 60 * 60 * 1000 },
    { label: '90+ days',      cutoff: 0 },
  ];
  let lastCutoff = Infinity;
  for (const b of ageBuckets) {
    const row = db.prepare(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(LENGTH(data)), 0) as bytes
      FROM part p
      JOIN session s ON p.session_id = s.id
      WHERE json_extract(p.data, '$.mime') LIKE 'image/%'
        AND s.time_created < ? AND s.time_created >= ?
    `).get(lastCutoff, b.cutoff);
    console.log(`    ${b.label}: ${row.cnt} parts, ${formatBytes(row.bytes)}`);
    lastCutoff = b.cutoff;
  }
  console.log('');

  // Check last run
  if (existsSync(LAST_RUN_PATH)) {
    const lastRun = readFileSync(LAST_RUN_PATH, 'utf-8').trim();
    console.log(`  Last GC run: ${lastRun}`);
  } else {
    console.log('  Last GC run: never');
  }

  db.close();
  process.exit(0);
}

// ── Main GC Logic ──────────────────────────────────────────────────────────
console.log(`── opencode Image Garbage Collection ──`);
console.log(`  Threshold: ${thresholdDays} days (sessions before ${formatDate(cutoffMs)})`);
console.log(`  Mode:      ${isApply ? 'APPLY (will delete data)' : 'DRY-RUN (use --apply to delete)'}`);
console.log('');

try {
  // Find candidate image parts in old sessions
  const candidates = db.prepare(`
    SELECT p.id, p.session_id, s.time_created, s.title,
           json_extract(p.data, '$.mime') as mime,
           LENGTH(p.data) as bytes
    FROM part p
    JOIN session s ON p.session_id = s.id
    WHERE json_extract(p.data, '$.mime') LIKE 'image/%'
      AND s.time_created < ?
    ORDER BY s.time_created ASC
  `).all(cutoffMs);

  const totalCandidates = candidates.length;
  const totalBytes = candidates.reduce((sum, r) => sum + r.bytes, 0);

  // Group by session
  const bySession = {};
  for (const r of candidates) {
    if (!bySession[r.session_id]) {
      bySession[r.session_id] = {
        sessionId: r.session_id,
        created: r.time_created,
        title: r.title || '(untitled)',
        count: 0,
        bytes: 0,
      };
    }
    bySession[r.session_id].count++;
    bySession[r.session_id].bytes += r.bytes;
  }

  // Overall DB size info
  const dbSize = existsSync(DB_PATH) ? (await import('fs')).statSync(DB_PATH).size : 0;

  console.log(`  Candidates found: ${totalCandidates} image parts`);
  console.log(`  Total reclaimable: ${formatBytes(totalBytes)}`);
  console.log(`  Database size:     ${formatBytes(dbSize)}`);
  console.log(`  Sessions affected: ${Object.keys(bySession).length}`);
  console.log('');

  if (totalCandidates > 0) {
    console.log('  Sessions with old images:');
    const sessionList = Object.values(bySession).sort((a, b) => a.created - b.created);
    for (const s of sessionList) {
      console.log(`    ${s.sessionId.slice(0, 20)}…  ${s.count} images  ${formatBytes(s.bytes)}  [${formatDate(s.created)}]  ${s.title.slice(0, 60)}`);
    }
    console.log('');

    if (isApply) {
      // Actually delete
      const deleteStmt = db.prepare(`
        DELETE FROM part
        WHERE json_extract(data, '$.mime') LIKE 'image/%'
          AND session_id IN (
            SELECT id FROM session WHERE time_created < ?
          )
      `);
      const result = deleteStmt.run(cutoffMs);
      console.log(`  ✅ Deleted ${result.changes} rows`);

      // Write last-run marker
      writeFileSync(LAST_RUN_PATH, new Date().toISOString(), 'utf-8');
      console.log(`  ✅ Last-run marker written`);
    } else {
      console.log(`  ⚠️  DRY-RUN — no changes made. Rerun with --apply to delete.`);
    }
  } else {
    console.log(`  ✅ No images older than ${thresholdDays} days. Nothing to clean.`);

    // Still write last-run marker so we know it ran
    if (isApply) {
      writeFileSync(LAST_RUN_PATH, new Date().toISOString(), 'utf-8');
      console.log(`  ✅ Last-run marker written`);
    }
  }

  console.log('');
  console.log(`  Done.`);
} catch (err) {
  console.error('Error during GC:', err.message);
  process.exit(1);
} finally {
  db.close();
}
