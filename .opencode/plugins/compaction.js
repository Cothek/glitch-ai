// compaction.js — OpenCode plugin for R3 compaction protocol
// Hooks experimental.session.compacting (may change between OpenCode versions)
// If this hook stops firing, check for:
// 1. Event renamed (e.g., "session.compacting" without "experimental" prefix)
// 2. Compaction system redesigned
// The run-compaction.mjs script is the fallback manual path
//
// THROTTLING (2026-08-18): Steps 6-9 (pattern scan, self-review, skill
// improvement review, curriculum) are expensive — they load skills and can
// dispatch sub-agents. They now run only every 3rd compaction OR once per
// day (whichever comes first), tracked in data/compaction-state.json.
// Steps 1-5 (timestamp, scratchpad promotion, diary, commit, GC) run every
// compaction — they are cheap and necessary for persistence.
//
// PROMPT TRIMMING (2026-08-18): scratchpad capped at 10 lines, skill
// improvements + reminders at 5 lines each — the old 20/10/10 caps made the
// injected prompt average 28KB (7K tokens) per compaction.

import { readFile, writeFile, mkdir, rename } from "fs/promises";
import { join } from "path";

const HEAVY_EVERY_N = 3; // run steps 6-9 every N compactions
const HEAVY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // ...or once per day

export const CompactionPlugin = async ({ directory, client }) => {
  console.log("[compaction] Plugin loaded — waiting for session.compacting events");

  const stateFile = join(directory, "data", "compaction-state.json");

  async function loadState() {
    try {
      const raw = await readFile(stateFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          count: typeof parsed.count === "number" ? parsed.count : 0,
          lastHeavyRun: typeof parsed.lastHeavyRun === "number" ? parsed.lastHeavyRun : null,
        };
      }
    } catch (e) {
      // ENOENT or parse error — start fresh
    }
    return { count: 0, lastHeavyRun: null };
  }

  async function saveState(state) {
    try {
      await mkdir(join(directory, "data"), { recursive: true });
      const tmpFile = stateFile + ".tmp";
      await writeFile(tmpFile, JSON.stringify(state, null, 2), "utf8");
      await rename(tmpFile, stateFile);
    } catch (e) {
      console.error(`[compaction] Failed to save state: ${e.message}`);
    }
  }

  return {
    "experimental.session.compacting": async (input, output) => {
      const todayStr = new Date().toISOString().split("T")[0];
      let scratchpadLines = "(No scratchpad found)";
      let skillImpLines = "(No pending skill improvements)";
      let reminderLines = "(No open reminders)";

      // Read current session scratchpad
      try {
        const sessionPath = join(directory, "user", "current-session.md");
        const sessionContent = await readFile(sessionPath, "utf-8");
        const scratchMatch = sessionContent.match(/(?:### Scratchpad \(Real-time\)|## Working Memory \(Scratchpad\))\s*([\s\S]*?)(?=\n##|\n---|$)/);
        if (scratchMatch) {
          const lines = scratchMatch[1].trim().split("\n").filter(l => l.trim());
          // Take last 10 lines max (was 20 — trimmed 2026-08-18)
          scratchpadLines = lines.slice(-10).join("\n").trim() || "(Empty scratchpad)";
        }
      } catch (e) {
        scratchpadLines = `(Error reading scratchpad: ${e.message})`;
      }

      // Read pending skill improvements
      try {
        const skillPath = join(directory, "user", "pending-skill-improvements.md");
        const skillContent = await readFile(skillPath, "utf-8");
        const skillLines = skillContent.split("\n").filter(l => l.startsWith("- [") || l.startsWith("### "));
        skillImpLines = skillLines.slice(0, 5).join("\n").trim() || "(No entries)";
      } catch (e) {
        skillImpLines = "(File not found)";
      }

      // Read reminders
      try {
        const reminderPath = join(directory, "user", "reminders.md");
        const reminderContent = await readFile(reminderPath, "utf-8");
        const openMatch = reminderContent.match(/## Open\s*([\s\S]*?)(?=\n##|$)/);
        if (openMatch) {
          const lines = openMatch[1].trim().split("\n").filter(l => l.trim());
          reminderLines = lines.slice(0, 5).join("\n").trim() || "(No open reminders)";
        }
      } catch (e) {
        reminderLines = "(File not found)";
      }

      // Throttle steps 6-9: run every 3rd compaction OR once per day
      const state = await loadState();
      state.count += 1;
      const now = Date.now();
      const heavyDue = state.count % HEAVY_EVERY_N === 0 ||
        (state.lastHeavyRun !== null && now - state.lastHeavyRun > HEAVY_MAX_AGE_MS) ||
        state.lastHeavyRun === null;
      if (heavyDue) {
        state.lastHeavyRun = now;
      }
      await saveState(state);

      const heavyNote = heavyDue
        ? "This is a heavy cycle — steps 6-9 are included below."
        : `Heavy steps throttled (cycle ${state.count % HEAVY_EVERY_N}/${HEAVY_EVERY_N}, last heavy ${state.lastHeavyRun ? new Date(state.lastHeavyRun).toISOString().slice(0, 16) : "never"}). Steps 6-9 omitted this cycle.`;

      // Build the structured compaction prompt
      const heavySteps = heavyDue ? [
        ``,
        `## Step 6 — Pattern Scan`,
        `Scan the scratchpad + this session for 3x+ repeated workflows or crystallized patterns. If found, load skill("forge") and create a skill entry.`,
        ``,
        `## Step 7 — Self-Review`,
        `Load skill("self-review") and perform system health review. Scan: opencode.json, skills-registry, prompt-rules, performance patterns. Produce BLOCKER/ISSUE/SUGGESTION report.`,
        ``,
        `## Step 8 — Curriculum`,
        `Load skill("curriculum"). Check if 2+ compaction cycles since last attempt. If yes, run next challenge.`,
        ``,
        `## Step 9 — Staleness Check`,
        `Scan main-memory.md for stale references. Check patterns.md, forge-log.md for 14+ day staleness. Archive diary entries older than 30 days to monthly summaries.`,
      ] : [];

      output.prompt = [
        `# Compaction Protocol — All 9 Steps Required`,
        ``,
        `You are generating a continuation prompt that must carry forward ALL state needed to resume work. Execute ALL 9 steps below.`,
        ``,
        `## Current Session Context`,
        `- Date: ${todayStr}`,
        `- This is a scheduled compaction (every ~8 turns)`,
        `- ${heavyNote}`,
        ``,
        `## Step 1 — Update Timestamp`,
        `Update the "Last Memory Update" timestamp in user/current-session.md to now (ISO format).`,
        ``,
        `## Step 2 — Promote Scratchpad`,
        `Scan the Working Memory scratchpad section for bullet points. For each entry:`,
        `- Learned about user? → Append to user/main-memory.md under Troy Profile`,
        `- Decision made? → Append to user/decisions.md with D-NNN format`,
        `- Something broke? → Append to user/post-mortems.md with PM-NNN format`,
        `- Reminder needed? → Append to user/reminders.md under Open`,
        `- Pattern discovered (2+ occurrences)? → Append to user/patterns.md`,
        `- Project work? → Update user/projects/project-list.md`,
        `- Workstream change? → Update user/session-dashboard.md`,
        `- 🔧 OPERATIONAL/PATTERN/FEEDBACK tag? → Promote to post-mortems.md, patterns.md, forge-log.md, or pending-skill-improvements.md as appropriate`,
        ``,
        `## Step 3 — Diary Entry`,
        `If session was substantial (10+ turns or major work since last compaction), write a diary entry to user/daily-diary/current/${todayStr}.md with a concise summary of what was accomplished.`,
        ``,
        `## Step 4 — Git Commit`,
        `Run: git add -A && git commit -m "memory: compaction ${todayStr}" && git push`,
        `If user/ is a separate git repo, also commit there.`,
        `ONLY dispatch @general for the commit if git status is dirty (run-compaction.mjs reports it). If clean, skip the dispatch.`,
        ``,
        `## Step 5 — Image GC Stats`,
        `Run: node scripts/cleanup-opencode-images.mjs --stats`,
        `If any images are 90+ days old, flag them for --apply.`,
        ...heavySteps,
        ``,
        `## Current Scratchpad Contents (last 10 lines)`,
        `\`\`\``,
        scratchpadLines,
        `\`\`\``,
        ``,
        `## Pending Skill Improvements`,
        `\`\`\``,
        skillImpLines,
        `\`\`\``,
        ``,
        `## Open Reminders`,
        `\`\`\``,
        reminderLines,
        `\`\`\``,
        ``,
        `## Summary`,
        `Generate a continuation prompt summarizing: current task status, files being modified, any blockers, and next steps. Include all relevant context the AI needs to resume seamlessly.`,
      ].join("\n");
    },
  };
};