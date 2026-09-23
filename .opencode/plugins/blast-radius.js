// blast-radius.js — OpenCode plugin: pre-edit blast-radius surfacing
//
// PURPOSE
//   Automates Glitch's R9 "run impact analysis before editing" discipline by
//   surfacing the blast radius BEFORE an edit/write. When the agent is about to
//   edit or write a file, this plugin runs a blast-radius query against that
//   file and injects "what depends on this file" into the next LLM message —
//   so the agent sees the blast radius inline, before it makes the change,
//   instead of having to remember to call impact() manually.
//
// BACKEND — GitNexus (already installed + indexed in Glitch):
//   Default command: `gitnexus impact {file} --summary-only`
//   `impact` accepts a file path as its target (resolves to a File node) and
//   returns the upstream dependants (who depends on this file) with a risk
//   rating. `--summary-only` keeps the injected text concise (counts + risk).
//
//   NOTE (staleness): GitNexus indexes are built by `gitnexus analyze` and can
//   drift stale. When the index doesn't cover the file, impact returns
//   "not found" / impactedCount 0 / risk UNKNOWN — which is itself a useful
//   signal ("re-index needed"). The hook degrades gracefully; it never crashes
//   or blocks the tool loop.
//
// MECHANISM (mirrors mulahazah.js / stuck-detector.js):
//   1. "tool.execute.before" fires before every tool call. When the tool is
//      `edit` or `write`, run the blast-radius command and write the result to
//      a per-session signal file: data/blast-radius/<sessionID>.json
//   2. "experimental.chat.messages.transform" fires after messages are read
//      from the DB and before they reach the LLM. If a fresh signal exists for
//      the session, inject a synthetic text part into the last message so the
//      agent is FORCED to see the blast radius before continuing.
//
// CONFIG (env vars):
//   - BLAST_RADIUS_COMMAND   — full command template; `{file}` is replaced with
//     the edited file path (relativized to the repo root). Default:
//     "gitnexus impact {file} --summary-only"
//   - BLAST_RADIUS_TIMEOUT_MS — max ms to wait for the command (default 8000)
//   - BLAST_RADIUS_DISABLED  — set "1" to disable the hook entirely
//
// SAFETY / NON-BLOCKING:
//   - The command runs with a hard timeout and is fire-and-forget; it never
//     blocks the tool execution (R22: no blocking commands in the agent loop).
//   - If gitnexus is not installed, the spawn fails fast and the hook degrades
//     to a no-op with a single warning log (no crash, no retry storm).
//   - A per-session cooldown prevents spamming on rapid multi-edit bursts.
//
// Install: add ".opencode/plugins/blast-radius.js" to the "plugin" array in
//   config/opencode-*.json (the templates the launch scripts copy to opencode.json).

import { promises as fs } from "fs";
import { join, relative, isAbsolute } from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

const SIGNAL_TTL_MS = 5 * 60 * 1000; // 5 min — a blast radius is only relevant right around the edit
const COOLDOWN_MS = 30 * 1000; // per-file cooldown to avoid re-querying the same file in a burst

const WATCHED_TOOLS = new Set(["edit", "write"]);

export const BlastRadiusPlugin = async ({ directory }) => {
  const dataDir = join(directory, "data");
  const signalDir = join(dataDir, "blast-radius");

  const disabled = process.env.BLAST_RADIUS_DISABLED === "1";
  const commandTemplate = process.env.BLAST_RADIUS_COMMAND || "gitnexus impact {file} --summary-only";
  const timeoutMs = Number(process.env.BLAST_RADIUS_TIMEOUT_MS) || 8000;

  // Per-session in-memory state: last time we queried each file (cooldown).
  const lastQuery = new Map(); // key: `${sessionID}:${filePath}` -> timestamp

  try {
    await fs.mkdir(signalDir, { recursive: true });
  } catch (err) {
    console.error(`[blast-radius] failed to create signal dir: ${err.message}`);
  }

  function signalPath(sessionID) {
    return join(signalDir, `${sessionID}.json`);
  }

  /** Extract the edited file path from tool args (edit/write both use filePath). */
  function extractFilePath(args) {
    if (!args || typeof args !== "object") return null;
    const fp = args.filePath || args.path || args.file;
    if (typeof fp === "string" && fp.trim()) return fp.trim();
    return null;
  }

  /**
   * Relativize an absolute path to the repo root, normalizing to forward
   * slashes. This strips the (space-containing) repo root prefix so the path
   * survives cmd.exe /c argv splitting on Windows.
   */
  function relativize(filePath) {
    if (isAbsolute(filePath)) {
      const rel = relative(directory, filePath);
      if (rel && !rel.startsWith("..")) return rel.replace(/\\/g, "/");
    }
    return filePath.replace(/\\/g, "/");
  }

  /**
   * Run the blast-radius command. Returns the trimmed stdout, or null on any
   * failure (missing binary, timeout). Never throws. Non-empty stdout is
   * accepted regardless of exit code — impact reports "not found" / risk
   * UNKNOWN on exit 0, and a non-zero exit with useful stderr is still worth
   * surfacing.
   */
  function runBlastRadius(filePath) {
    return new Promise((resolve) => {
      const rel = relativize(filePath);

      // Split the template into argv FIRST, then substitute {file} into each
      // token. This keeps the (possibly space-containing) file path as a single
      // argv element instead of letting a naive split shatter it.
      const tokens = commandTemplate.split(/\s+/).filter(Boolean);
      const argv = tokens.map((t) => t.replaceAll("{file}", rel));
      const [bin, ...rest] = argv;

      let child;
      try {
        // Windows: `gitnexus` is a .cmd/.ps1 shim, which Node's spawn cannot
        // execute directly (ENOENT for the bare name, EINVAL for the .cmd).
        // Route through cmd.exe /c, which resolves the shim correctly.
        if (process.platform === "win32") {
          child = spawn("cmd.exe", ["/c", bin, ...rest], {
            cwd: directory,
            shell: false,
            windowsHide: true,
          });
        } else {
          child = spawn(bin, rest, {
            cwd: directory,
            shell: false,
          });
        }
      } catch (err) {
        console.warn(`[blast-radius] failed to spawn "${bin}": ${err.message}`);
        return resolve(null);
      }

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch {}
        resolve(result);
      };

      const timer = setTimeout(() => {
        console.warn(`[blast-radius] timed out after ${timeoutMs}ms: ${commandTemplate}`);
        finish(null);
      }, timeoutMs);

      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });

      child.on("error", (err) => {
        // ENOENT = gitnexus not installed. Log once, degrade to no-op.
        console.warn(`[blast-radius] command unavailable (${bin}): ${err.code === "ENOENT" ? "not installed" : err.message}`);
        clearTimeout(timer);
        finish(null);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const out = stdout.trim();
        if (out) {
          finish(out);
        } else {
          if (stderr.trim()) console.warn(`[blast-radius] command exited ${code} with no stdout: ${stderr.trim().slice(0, 200)}`);
          finish(null);
        }
      });
    });
  }

  async function writeSignal(sessionID, filePath, result) {
    const payload = {
      sessionID,
      filePath,
      result,
      ts: Date.now(),
    };
    try {
      await fs.writeFile(signalPath(sessionID), JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
      console.error(`[blast-radius] failed to write signal: ${err.message}`);
    }
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (disabled) return;
      try {
        const tool = input.tool || "unknown";
        if (!WATCHED_TOOLS.has(tool)) return;

        const filePath = extractFilePath(input.args);
        if (!filePath) return;

        const sessionID = input.sessionID || "unknown";
        const key = `${sessionID}:${filePath}`;
        const now = Date.now();
        if (lastQuery.has(key) && now - lastQuery.get(key) < COOLDOWN_MS) return;
        lastQuery.set(key, now);

        // Fire-and-forget: do NOT await in a way that blocks the tool loop.
        runBlastRadius(filePath).then((result) => {
          if (result) {
            writeSignal(sessionID, filePath, result);
            console.log(`[blast-radius] blast radius captured for ${filePath} (session ${sessionID})`);
          }
        });
      } catch (err) {
        console.error(`[blast-radius] tool.execute.before failed: ${err.message}`);
      }
    },

    "experimental.chat.messages.transform": async (input, output) => {
      if (disabled) return;
      try {
        if (!Array.isArray(output.messages) || output.messages.length === 0) return;

        const lastMessage = output.messages[output.messages.length - 1];
        const sessionID = lastMessage?.info?.sessionID ?? output.messages[0]?.info?.sessionID;
        if (!sessionID) return;

        const sp = signalPath(sessionID);
        let raw;
        try {
          raw = await fs.readFile(sp, "utf8");
        } catch (err) {
          if (err.code === "ENOENT") return;
          throw err;
        }

        let payload;
        try {
          payload = JSON.parse(raw);
        } catch {
          return;
        }

        // Stale signal — drop it, don't inject.
        if (!payload.ts || Date.now() - payload.ts > SIGNAL_TTL_MS) {
          try { await fs.unlink(sp); } catch {}
          return;
        }

        if (!lastMessage || !Array.isArray(lastMessage.parts)) return;

        const msgSessionID = lastMessage.info?.sessionID ?? sessionID;
        const messageID = lastMessage.info?.id ?? `msg_${randomUUID()}`;

        const directive =
          `[BLAST RADIUS] You are about to edit ${payload.filePath}. What depends on it:\n` +
          `---\n${payload.result}\n---\n` +
          `Consider whether these dependents need updating before you make the change.`;

        lastMessage.parts.push({
          id: `prt_${randomUUID()}`,
          sessionID: msgSessionID,
          messageID,
          type: "text",
          text: directive,
          synthetic: true,
        });

        // Consume the signal so it isn't re-injected on every subsequent message.
        try { await fs.unlink(sp); } catch {}

        console.log(`[blast-radius] injected blast radius for ${payload.filePath} (session ${sessionID})`);
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.error(`[blast-radius] transform hook failed: ${err.message}`);
        }
      }
    },
  };
};