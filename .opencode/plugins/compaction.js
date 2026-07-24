// compaction.js — OpenCode plugin for R3 compaction protocol
// Hooks experimental.session.compacting (may change between OpenCode versions)
// If this hook stops firing, check for:
// 1. Event renamed (e.g., "session.compacting" without "experimental" prefix)
// 2. Compaction system redesigned
// The run-compaction.mjs script is the fallback manual path

import { readFile } from "fs/promises";
import { join } from "path";

export const CompactionPlugin = async ({ directory, client }) => {
  console.log("[compaction] Plugin loaded — waiting for session.compacting events");
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
        const scratchMatch = sessionContent.match(/### Scratchpad \(Real-time\)\s*([\s\S]*?)(?=\n##|\n---|$)/);
        if (scratchMatch) {
          const lines = scratchMatch[1].trim().split("\n").filter(l => l.trim());
          // Take last 20 lines max
          scratchpadLines = lines.slice(-20).join("\n").trim() || "(Empty scratchpad)";
        }
      } catch (e) {
        scratchpadLines = `(Error reading scratchpad: ${e.message})`;
      }

      // Read pending skill improvements
      try {
        const skillPath = join(directory, "user", "pending-skill-improvements.md");
        const skillContent = await readFile(skillPath, "utf-8");
        const skillLines = skillContent.split("\n").filter(l => l.startsWith("- [") || l.startsWith("### "));
        skillImpLines = skillLines.slice(0, 10).join("\n").trim() || "(No entries)";
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
          reminderLines = lines.slice(0, 10).join("\n").trim() || "(No open reminders)";
        }
      } catch (e) {
        reminderLines = "(File not found)";
      }

      // Build the structured compaction prompt
      output.prompt = [
        `# Compaction Protocol — All 9 Steps Required`,
        ``,
        `You are generating a continuation prompt that must carry forward ALL state needed to resume work. Execute ALL 9 steps below.`,
        ``,
        `## Current Session Context`,
        `- Date: ${todayStr}`,
        `- This is a scheduled compaction (every ~8 turns)`,
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
        ``,
        `## Step 5 — Image GC Stats`,
        `Run: node scripts/cleanup-opencode-images.mjs --stats`,
        `If any images are 90+ days old, flag them for --apply.`,
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
        ``,
        `## Current Scratchpad Contents (last 20 lines)`,
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