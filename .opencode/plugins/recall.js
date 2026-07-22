// recall.js — OpenCode plugin: custom recall tool for FTS5 memory search
// Wraps the existing search-memory.mjs CLI in a tool the AI can call directly.
// Returns ranked memory chunks from past preferences, decisions, patterns, etc.

import { tool } from "@opencode-ai/plugin";
import { spawnSync } from "child_process";
import { join } from "path";
import { existsSync } from "fs";

export const RecallPlugin = async ({ directory }) => {
  return {
    tool: {
      recall: tool({
        description: "Search Glitch's memory using full-text search over all memory files. Call this when you need to find past preferences, decisions, patterns, post-mortems, reminders, or any information stored in memory. Use conversational queries like 'what preferences does Troy have for UI design' or 'what decisions were made about the memory system'.",
        args: {
          query: tool.schema.string({
            description: "Natural language search query. Be specific. Examples: 'Troy's UI design preferences', 'memory compaction protocol decisions', 'Node.js install location'",
          }),
          limit: tool.schema.number().optional().default(5),
          include_json: tool.schema.boolean().optional().default(false),
        },
        async execute(args, context) {
          const dir = context.directory;
          const searchScript = join(dir, "glitch-memorycore", "plugins", "embed-search", "search-memory.mjs");
          const dbPath = join(dir, "glitch-memorycore", "plugins", "embed-search", "memory-search.db");
          const query = args.query;
          const limit = args.limit || 5;

          // Check if search script exists
          if (!existsSync(searchScript)) {
            return `🔍 Recall: Search script not found at ${searchScript}\n\nRun index-memory.mjs first: node glitch-memorycore/plugins/embed-search/index-memory.mjs`;
          }

          // Check if DB exists
          if (!existsSync(dbPath)) {
            return `🔍 Recall: Memory index not found. No database at ${dbPath}\n\nRun index-memory.mjs first: node glitch-memorycore/plugins/embed-search/index-memory.mjs`;
          }

          try {
            const proc = spawnSync("node", [
              searchScript,
              "-q", query,
              "--json",
              "--limit", String(limit),
            ], { encoding: "utf-8", timeout: 15000, cwd: dir });

            if (proc.error) throw proc.error;
            if (proc.status !== 0) throw new Error(proc.stderr || `exit code ${proc.status}`);

            const parsed = JSON.parse(proc.stdout);
            const results = Array.isArray(parsed) ? parsed : (parsed.results || []);
            const total = Array.isArray(parsed) ? parsed.length : (parsed.total || results.length);

            if (results.length === 0) {
              return [
                `🔍 Recall: "${query}" — 0 results found`,
                ``,
                `No matches in memory index. Try:`,
                `  • Different search terms (simpler or more specific)`,
                `  • Check if index needs rebuilding: node glitch-memorycore/plugins/embed-search/index-memory.mjs`,
              ].join("\n");
            }

            const lines = [
              `🔍 Recall: "${query}" — ${results.length} result(s) from ${total} match(es)`,
              ``,
            ];

            for (let i = 0; i < results.length; i++) {
              const r = results[i];
              const filePath = (r.file_path || "").replace(/\\/g, "/");
              const section = r.section_heading || "(unknown section)";
              const score = r.score !== undefined ? r.score.toFixed(2) : "N/A";
              const content = r.content || "";

              lines.push(`[${i + 1}] ${filePath}`);
              lines.push(`    Section: ${section}  |  Score: ${score}`);
              if (content) lines.push(`    ${content.replace(/\n/g, "\n    ")}`);
              lines.push(``);
            }

            lines.push(`Tip: Read the full context with read tool at the file paths above.`);

            return lines.join("\n");
          } catch (e) {
            // Check for common errors
            const errMsg = e.message || String(e);
            if (errMsg.includes("Cannot find module 'better-sqlite3'") || errMsg.includes("better-sqlite3")) {
              return `🔍 Recall: Search script missing dependency 'better-sqlite3'. Run: cd glitch-memorycore/plugins/embed-search && npm install`;
            }
            if (errMsg.includes("no such table")) {
              return `🔍 Recall: Memory index corrupted or empty. Rebuild: node glitch-memorycore/plugins/embed-search/index-memory.mjs`;
            }
            return `🔍 Recall: Search failed — ${errMsg.slice(0, 200)}`;
          }
        },
      }),
    },
  };
};
