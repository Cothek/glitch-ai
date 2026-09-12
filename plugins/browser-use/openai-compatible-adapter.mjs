/**
 * OpenAI-compatible LLM adapter for browser-use.
 *
 * The browser-use package's built-in ChatOpenAI adapter speaks OpenAI's NEWER
 * dialect (`max_completion_tokens`, `frequency_penalty`, `response_format:
 * json_schema`) which many OpenAI-compatible endpoints (NVIDIA NIM, OpenCode Go,
 * LM Studio, vLLM) reject with 400. This adapter speaks the OLDER dialect:
 *   - `max_tokens` instead of `max_completion_tokens`
 *   - no `frequency_penalty`
 *   - `response_format: { type: 'json_object' }` instead of `json_schema`
 *
 * It implements the browser-use `BaseChatModel` interface so it can be passed
 * directly to `new Agent({ llm })`.
 */

export async function createOpenAICompatibleLLM({ model, apiKey, baseUrl }) {
  const endpoint = `${(baseUrl || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '')}/chat/completions`;

  function serializeMessage(msg) {
    const role = msg.role; // 'user' | 'system' | 'assistant'
    let content;
    if (Array.isArray(msg.content)) {
      // ContentPart[] — handle text and image parts (vision)
      content = msg.content
        .map((part) => {
          if (part.type === 'text') return { type: 'text', text: part.text };
          if (part.type === 'image_url') {
            return { type: 'image_url', image_url: { url: part.image_url.url } };
          }
          return null;
        })
        .filter(Boolean);
    } else {
      content = msg.text ?? msg.content ?? '';
    }

    const out = { role, content };

    // Preserve assistant tool_calls (function calling) if present
    if (role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      out.tool_calls = msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.functionCall?.name, arguments: tc.functionCall?.arguments || '{}' },
      }));
    }

    return out;
  }

  return {
    model,
    get provider() { return 'openai-compatible'; },
    get name() { return 'OpenAI-compatible'; },
    get model_name() { return model; },

    async ainvoke(messages, output_format, options) {
      const body = {
        model,
        messages: messages.map(serializeMessage),
        max_tokens: 4096,
        temperature: 0.2,
      };

      // Structured output: use the older json_object format (widely supported).
      // The browser-use agent's system prompt already instructs JSON output, so
      // this is a hint, not a hard requirement.
      if (output_format) {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status} status code${text ? ': ' + text.slice(0, 500) : ''}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      const usage = data.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens || 0,
            completion_tokens: data.usage.completion_tokens || 0,
            total_tokens: data.usage.total_tokens || 0,
          }
        : null;

      // Parse structured output if a schema/parser was provided
      let completion = content;
      if (output_format) {
        try {
          const parsedJson = JSON.parse(content);
          if (output_format.schema && typeof output_format.schema.parse === 'function') {
            completion = output_format.schema.parse(parsedJson);
          } else if (typeof output_format.parse === 'function') {
            completion = output_format.parse(parsedJson);
          }
        } catch {
          // Parse failure — return raw content; the agent will surface the error
          completion = content;
        }
      }

      const { ChatInvokeCompletion } = await import('browser-use/llm/views');
      return new ChatInvokeCompletion(completion, usage);
    },
  };
}