#!/usr/bin/env node

import { execSync } from "child_process";
import { readFile, writeFile, readdir, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(__dirname, "..");
const today = new Date();
const todayStr = formatDate(today);

function warn(msg) {
  console.error(`[compaction] ${msg}`);
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysSince(d) {
  const now = Date.now();
  const then = d.getTime();
  return Math.floor((now - then) / 86400000);
}

// --- Step 1: Update timestamp in current-session.md ---
async function updateTimestamp() {
  const fp = path.join(CWD, "user", "current-session.md");
  try {
    let content = await readFile(fp, "utf-8");
    const ts = `${todayStr}T${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}:00Z`;
    content = content.replace(
      /^(\*\*Last Memory Update\*\*: ).*/m,
      `$1${ts}`
    );
    await writeFile(fp, content, "utf-8");
    return `✓ Last Memory Update: ${ts}`;
  } catch (e) {
    warn(`Failed to update timestamp: ${e.message}`);
    return `✗ Last Memory Update: FAILED (${e.message})`;
  }
}

// --- Step 2: Diary staleness check ---
async function checkDiaryStaleness() {
  const diaryDir = path.join(CWD, "user", "daily-diary", "current");
  try {
    await stat(diaryDir);
  } catch {
    return "✓ Diary staleness: N/A (no diary directory)";
  }

  try {
    const files = await readdir(diaryDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    if (mdFiles.length === 0) {
      return "✓ Diary staleness: N/A (no diary files)";
    }

    const oldEntries = [];
    for (const f of mdFiles) {
      const fstat = await stat(path.join(diaryDir, f));
      const ageDays = daysSince(fstat.mtime);
      if (ageDays > 30) {
        oldEntries.push({ file: f, age: ageDays, month: `${fstat.mtime.getFullYear()}-${String(fstat.mtime.getMonth() + 1).padStart(2, "0")}` });
      }
    }

    if (oldEntries.length === 0) {
      return "✓ Diary staleness: OK (no entries >30 days old)";
    }

    const monthCounts = {};
    for (const e of oldEntries) {
      monthCounts[e.month] = (monthCounts[e.month] || 0) + 1;
    }

    const archiveFlags = Object.entries(monthCounts)
      .filter(([, count]) => count >= 3)
      .map(([month]) => `${month} (${monthCounts[month]} entries)`);

    let msg = `⚠️ Diary staleness: ${oldEntries.length} entries >30 days old`;
    if (archiveFlags.length > 0) {
      msg += ` — archive candidates: ${archiveFlags.join(", ")}`;
    }
    return msg;
  } catch (e) {
    warn(`Diary check failed: ${e.message}`);
    return `✗ Diary staleness: FAILED (${e.message})`;
  }
}

// --- Step 3: Curriculum status ---
async function checkCurriculum() {
  const fp = path.join(CWD, "glitch-memorycore", "plugins", "curriculum", "curriculum-state.json");
  try {
    const content = await readFile(fp, "utf-8");
    const data = JSON.parse(content);
    const level = data.level ?? "N/A";
    const completed = (data.completedChallenges ?? []).length;
    const toolsCreated = data.toolsCreated ?? 0;
    const startedAt = data.startedAt;
    const toolsAtStart = data.toolsAtStart ?? 0;
    const toolsNeeded = 3 - toolsCreated;
    const promotionProgress = `tools: ${toolsCreated - toolsAtStart} new (${toolsCreated}/${toolsAtStart + 3} for promotion)`;

    let startedStatus = startedAt !== null && startedAt !== undefined
      ? `started: yes (${String(startedAt)})`
      : "⚠️ started: NO — curriculum has never been started";

    return `✓ Curriculum: Level ${level} | ${completed} challenges done | ${promotionProgress} | ${startedStatus}`;
  } catch (e) {
    warn(`Curriculum check failed: ${e.message}`);
    return `✗ Curriculum: FAILED (${e.message})`;
  }
}

// --- Step 5: Image GC (opencode DB) ---
async function checkImageGC() {
  const scriptPath = path.join(CWD, "scripts", "cleanup-opencode-images.mjs");
  try {
    await stat(scriptPath);
  } catch {
    return "✓ Image GC: N/A (script not found)";
  }

  try {
    const output = execSync(
      `node "${scriptPath}" --stats`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 15000 }
    );
    // Parse key lines
    const lines = output.trim().split("\n");
    const totalLine = lines.find(l => l.trim().startsWith("Total image parts:"));
    const sizeLine = lines.find(l => l.trim().startsWith("Total image size:"));
    const lastRunLine = lines.find(l => l.trim().startsWith("Last GC run:"));
    const gcTargetLine = lines.find(l => l.trim().includes("90+ days"));

    let msg = `✓ Image GC: ${totalLine ? totalLine.trim() : ""} | ${sizeLine ? sizeLine.trim() : ""}`;
    if (lastRunLine) msg += ` | ${lastRunLine.trim()}`;

    // Flag if any images are past the 90-day threshold
    if (gcTargetLine) {
      const match = gcTargetLine.match(/90\+\s+days:\s+(\d+)\s+parts/);
      if (match && parseInt(match[1], 10) > 0) {
        msg += `\n⚠️  IMAGE_GC_ALERT: ${match[1]} image(s) are 90+ days old — run with --apply to reclaim space`;
      }
    }

    return msg;
  } catch (e) {
    warn(`Image GC check failed: ${e.message}`);
    return `✗ Image GC: FAILED (${e.message})`;
  }
}

// --- Step 4: Git status ---
async function checkGit() {
  try {
    const output = execSync("git status --short", { cwd: CWD, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const lines = output.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      return "✓ Git: clean";
    }
    return `⚠️ Git: ${lines.length} file(s) uncommitted\n${lines.map((l) => `   ${l}`).join("\n")}`;
  } catch (e) {
    warn(`Git check failed: ${e.message}`);
    return `✗ Git: FAILED (${e.message})`;
  }
}

// --- Step 4d: Memory file staleness check ---
async function checkMemoryStaleness() {
  const userDir = path.join(CWD, "user");
  const filesToCheck = [
    { name: "patterns.md", path: path.join(userDir, "patterns.md") },
    { name: "forge-log.md", path: path.join(userDir, "forge-log.md") },
    { name: "external-sources.md", path: path.join(userDir, "library", "external-sources.md") },
  ];

  const results = [];
  const staleFiles = [];

  for (const file of filesToCheck) {
    try {
      const content = await readFile(file.path, "utf-8");
      const match = content.match(/^\s*timestamp:\s*(.+)$/m);
      if (match) {
        const tsStr = match[1].trim();
        const ts = new Date(tsStr);
        if (isNaN(ts.getTime())) {
          results.push(`⚠ ${file.name} — invalid timestamp format: ${tsStr}`);
        } else {
          const days = daysSince(ts);
          const dateStr = formatDate(ts);
          if (days > 14) {
            results.push(`⚠ ${file.name} — last updated ${dateStr} (${days} days ago) — review for promotion`);
            staleFiles.push(file.name);
          } else {
            results.push(`✓ ${file.name} — current (${days} days ago)`);
          }
        }
      } else {
        results.push(`⚠ ${file.name} — not found or no timestamp`);
        staleFiles.push(file.name);
      }
    } catch (e) {
      if (e.code === "ENOENT") {
        results.push(`⚠ ${file.name} — not found or no timestamp`);
        staleFiles.push(file.name);
      } else {
        warn(`Memory staleness check failed for ${file.name}: ${e.message}`);
        results.push(`✗ ${file.name}: FAILED (${e.message})`);
      }
    }
  }

  return { lines: results, hasStale: staleFiles.length > 0 };
}

// --- Step 5.5: Skill improvement review ---
async function checkSkillImprovements() {
  const fp = path.join(CWD, "user", "pending-skill-improvements.md");
  try {
    const content = await readFile(fp, "utf-8");

    const skillCounts = {};
    const lines = content.split("\n");
    let currentSkill = null;
    let totalEntries = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const headingMatch = line.match(/^###\s+(.+)/);
      if (headingMatch) {
        currentSkill = headingMatch[1].trim();
        continue;
      }

      const entryMatch = line.match(/^- \[(\d{4}-\d{2}-\d{2})\]/);
      if (entryMatch && currentSkill) {
        totalEntries++;

        let significance = "minor";
        let status = "pending";
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const meta = lines[j];
          if (meta.includes("→ Significance:")) {
            const sigMatch = meta.match(/→ Significance:\s*(\S+)/i);
            if (sigMatch) significance = sigMatch[1].toLowerCase();
          } else if (meta.includes("→ Status:")) {
            const statMatch = meta.match(/→ Status:\s*(\S+)/i);
            if (statMatch) status = statMatch[1].toLowerCase();
          }
          if (meta.match(/^- \[|^###/)) break;
        }

        if (!skillCounts[currentSkill]) {
          skillCounts[currentSkill] = { total: 0, pending: 0, major: 0, critical: 0, notable: 0 };
        }
        skillCounts[currentSkill].total++;
        if (status === "pending") {
          skillCounts[currentSkill].pending++;
        }
        if (significance === "major") skillCounts[currentSkill].major++;
        else if (significance === "critical") skillCounts[currentSkill].critical++;
        else if (significance === "notable") skillCounts[currentSkill].notable++;
      }
    }

    if (totalEntries === 0) {
      return { lines: ["✓ Skill improvements: none pending"], hasPending: false, skills: {} };
    }

    const resultLines = [];
    let totalPending = 0;
    for (const [skill, counts] of Object.entries(skillCounts)) {
      if (counts.pending > 0) {
        let signal = "minor";
        if (counts.critical >= 1) signal = "CRITICAL — present immediately";
        else if (counts.major >= 1) signal = "SIGNIFICANT — present at next compaction";
        else if (counts.pending >= 2) signal = "SIGNIFICANT — 2+ entries";
        else if (counts.notable >= 1) signal = "notable — needs 2nd occurrence";

        resultLines.push(
          `  ${skill}: ${counts.pending} pending (${counts.total} total)` +
          (counts.critical > 0 ? `, ${counts.critical} critical` : "") +
          (counts.major > 0 ? `, ${counts.major} major` : "") +
          ` — ${signal}`
        );
        totalPending += counts.pending;
      }
    }

    if (totalPending === 0) {
      return { lines: ["✓ Skill improvements: all applied or rejected"], hasPending: false, skills: {} };
    }

    return {
      lines: [
        `📋 Skill improvements: ${totalPending} pending across ${Object.keys(skillCounts).filter(s => skillCounts[s].pending > 0).length} skills`,
        ...resultLines,
        "  → Load forge skill (`skill \"forge\"`) to review and apply level-ups",
      ],
      hasPending: true,
      skills: skillCounts,
    };
  } catch (e) {
    if (e.code === "ENOENT") {
      return { lines: ["✓ Skill improvements: N/A (no pending-skill-improvements.md)"], hasPending: false, skills: {} };
    }
    warn(`Skill improvement check failed: ${e.message}`);
    return { lines: [`⚠ Skill improvements: check failed (${e.message})`], hasPending: false, skills: {} };
  }
}

// --- Step 4b: Touch timestamps on all user memory files ---
async function touchAllTimestamps() {
  const userDir = path.join(CWD, "user");
  const files = [
    "main-memory.md",
    "decisions.md",
    "patterns.md",
    "post-mortems.md",
    "reminders.md",
    "forge-log.md",
    "projects/project-list.md",
    "session-dashboard.md",
    "daily-diary",
  ];
  const todayISO = `${todayStr}T00:00:00Z`;
  const results = [];

  for (const f of files) {
    try {
      if (f === "daily-diary") {
        // For diary, try the current date file
        const diaryPath = path.join(userDir, "daily-diary", "current", `${todayStr}.md`);
        try {
          await stat(diaryPath);
          let content = await readFile(diaryPath, "utf-8");
          if (content.includes("timestamp:")) {
            content = content.replace(
              /^(\s*timestamp:\s*).*/m,
              `$1${todayISO}`
            );
            await writeFile(diaryPath, content, "utf-8");
            results.push(`✓ ${f}/current/${todayStr}.md`);
          }
        } catch {
          // diary file doesn't exist yet — skip
        }
        continue;
      }

      const fp = path.join(userDir, f);
      try {
        await stat(fp);
      } catch {
        results.push(`✗ ${f}: not found`);
        continue;
      }

      let content = await readFile(fp, "utf-8");
      if (content.includes("timestamp:")) {
        content = content.replace(
          /^(\s*timestamp:\s*).*/m,
          `$1${todayISO}`
        );
        await writeFile(fp, content, "utf-8");
        results.push(`✓ ${f}`);
      } else {
        results.push(`⚠ ${f}: no timestamp field found`);
      }
    } catch (e) {
      warn(`touchAllTimestamps: ${f} failed: ${e.message}`);
      results.push(`✗ ${f}: ${e.message}`);
    }
  }

  return results;
}

// --- Main ---
async function main() {
  const results = {
    timestamp: await updateTimestamp(),
    diary: await checkDiaryStaleness(),
    curriculum: await checkCurriculum(),
    gc: await checkImageGC(),
    git: await checkGit(),
    touches: await touchAllTimestamps(),
    staleness: await checkMemoryStaleness(),
    skillImp: await checkSkillImprovements(),
  };

  // Split GC result into main line + potential alert
  const gcLines = results.gc.split("\n");
  const gcMain = gcLines[0];
  const gcAlert = gcLines.length > 1 ? gcLines.slice(1) : [];

  const lines = [
    "",
    `📋 Compaction Run — ${todayStr}`,
    "",
    "=== Auto-Completed ===",
    results.timestamp,
    ...results.touches,
    results.diary,
    results.curriculum,
    gcMain,
    ...results.git.split("\n"),
    "",
    "=== Action Required ===",
    "⚠️ Step 6 — Pattern scan: Check scratchpad for 3x+ repeated workflows",
    "⚠️ Step 7 — Self-review: Load self-review skill, scan system files",
    "⚠️ Step 8 — Curriculum: Verify next challenge or check cooldown",
    "⚠️ Step 9 — Staleness: Scan main-memory.md for stale refs",
    ...gcAlert,
    "",
    "=== Memory File Staleness ===",
    ...results.staleness.lines,
    ...(results.staleness.hasStale
      ? ["", "📋 Action: Review stale memory files above — promote scratchpad entries, update patterns/forge-log as needed"]
      : []),
    ...(results.skillImp.hasPending
      ? ["", "=== Skill Improvements Pending ===", ...results.skillImp.lines]
      : []),
    "",
    "=== Suggested Command ===",
    `git add -A && git commit -m "memory: compaction ${todayStr}"`,
    "",
  ];

  console.log(lines.join("\n"));
  process.exit(0);
}

main().catch((e) => {
  warn(`Fatal: ${e.message}`);
  process.exit(1);
});
