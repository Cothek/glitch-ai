#!/usr/bin/env node
// probe-freetoken-limit.mjs -- Dynamically detect the real KV cache budget of the FreeToken server.
//
// The FreeToken server advertises max_model_len=262144 in /v1/models, but the ACTUAL
// KV cache budget is much smaller (observed 65536 tokens). OpenCode trusts the
// configured limit.context, so if it's set too high, OpenCode never compacts early
// enough and the server rejects with "prompt is too long: N tokens > M maximum".
//
// This script binary-searches the real budget by sending chat completions with
// prompts of increasing size until the server rejects. It then prints the detected
// limit so it can be written into opencode.json (or used to warn the user).
//
// Usage:
//   node scripts/probe-freetoken-limit.mjs [--base-url http://192.168.68.64:1919/v1] [--model Qwen3.6-35B-A3B-NVFP4]
//
// Output (JSON on stdout):
//   { "advertised": 262144, "detected": 65536, "safe_context": 57344, "safe_output": 8192 }

const BASE_URL = process.env.FREETOKEN_BASE_URL || "http://192.168.68.64:1919/v1";
const MODEL = process.env.FREETOKEN_MODEL || "Qwen3.6-35B-A3B-NVFP4";

// Rough token estimate: ~4 chars per token for English text. We use a conservative
// 3 chars/token so our probe prompts are at least as long (in tokens) as we think.
const CHARS_PER_TOKEN = 3;

async function probe(promptChars) {
  const body = {
    model: MODEL,
    messages: [{ role: "user", content: "x".repeat(promptChars) }],
    max_tokens: 1,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (res.ok) {
      return { ok: true, promptTokens: Math.floor(promptChars / CHARS_PER_TOKEN) };
    }
    // Parse the "prompt is too long: N tokens > M maximum" message
    const m = text.match(/prompt is too long:\s*(\d+)\s*tokens\s*>\s*(\d+)\s*maximum/i);
    if (m) {
      return {
        ok: false,
        promptTokens: parseInt(m[1], 10),
        maxTokens: parseInt(m[2], 10),
        message: text.slice(0, 300),
      };
    }
    return { ok: false, promptTokens: Math.floor(promptChars / CHARS_PER_TOKEN), message: text.slice(0, 300) };
  } catch (e) {
    return { ok: false, promptTokens: Math.floor(promptChars / CHARS_PER_TOKEN), message: `fetch error: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  // First, get the advertised limit
  let advertised = 262144;
  try {
    const res = await fetch(`${BASE_URL}/models`);
    const data = await res.json();
    const model = data.data?.find((m) => m.id === MODEL);
    advertised = model?.max_model_len || model?.context_length || advertised;
  } catch {}

  // Binary search for the real limit. We probe with prompt sizes in chars.
  // Start range: 10K tokens to 200K tokens (in chars).
  let lo = 10000; // tokens (known to succeed)
  let hi = 200000; // tokens (known to fail, well above advertised)
  let lastOk = lo;
  let lastFail = null;

  // First verify lo succeeds and hi fails
  const loRes = await probe(lo * CHARS_PER_TOKEN);
  if (!loRes.ok) {
    // Even 10K tokens fails - the budget is tiny. Search lower.
    hi = lo;
    lo = 1000;
  }
  const hiRes = await probe(hi * CHARS_PER_TOKEN);
  if (hiRes.ok) {
    // Even 200K tokens succeeds - budget is huge. Extend.
    hi = 400000;
  }

  // Binary search
  for (let i = 0; i < 20; i++) {
    if (hi - lo <= 2000) break;
    const mid = Math.floor((lo + hi) / 2);
    const res = await probe(mid * CHARS_PER_TOKEN);
    if (res.ok) {
      lastOk = mid;
      lo = mid;
    } else {
      lastFail = res;
      hi = mid;
    }
  }

  const detected = lastFail?.maxTokens || lastOk;
  // Safe context: the real budget IS the context window. OpenCode computes the
  // prompt budget as context - output, and compacts when prompt approaches
  // (context - output - reserved). So set context = detected budget, and let
  // output + reserved carve out the generation/compaction headroom.
  const safeOutput = 8192;
  const safeContext = detected;

  const result = {
    advertised,
    detected,
    safe_context: safeContext,
    safe_output: safeOutput,
    last_ok_tokens: lastOk,
    last_fail: lastFail ? { tokens: lastFail.promptTokens, max: lastFail.maxTokens, message: lastFail.message } : null,
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});