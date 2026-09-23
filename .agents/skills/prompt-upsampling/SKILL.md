---
name: prompt-upsampling
description: Expand short image prompts into detailed natural-language descriptions before calling generate_image. FLUX.2-klein-4B responds best to 75-150 token prompts with specific subject, lighting, composition, and style details.
---

# Prompt Upsampling

## When to Use

**Before every `generate_image` MCP call**, unless the user's prompt is already 75+ tokens of specific descriptive detail. This skill expands terse prompts into the kind of rich natural-language descriptions that FLUX.2-klein-4B rewards.

Do NOT use this skill for:
- Prompts that are already detailed (75+ tokens with subject, lighting, composition, style)
- Non-image tasks
- When the user explicitly says "use my prompt as-is"

## Why This Matters

FLUX.2-klein-4B is a guidance-distilled model trained on natural language (not Danbooru tags). It interprets semantic relationships between words, so:

- **"a cat"** → generic, unpredictable
- **"a fluffy orange tabby cat sitting on a sunlit windowsill, soft bokeh background, warm afternoon light, shot on 85mm lens"** → specific, high-quality output

The model has no negative prompt support, so all quality steering must happen in the positive prompt itself.

## Expansion Template

When expanding a prompt, generate a single-paragraph natural language description (75-150 tokens) that covers these axes in order:

1. **Subject** — What is the main focus? Be specific about species, age, material, condition.
2. **Action/Pose** — What is the subject doing? Static or dynamic?
3. **Environment** — Where is this? Indoor/outdoor, time of day, season.
4. **Camera** — Focal length feel (wide/normal/telephoto), angle (eye-level, low, overhead), depth of field.
5. **Lighting** — Quality (soft/hard), direction (front/back/rim), color temperature (warm/cool), source (natural/artificial).
6. **Composition** — Framing (close-up, full-body, wide establishing), rule of thirds, leading lines.
7. **Style** — Photographic, cinematic, illustration, painterly, minimalist, etc.
8. **Quality keywords** — Only add 2-3 at the end: "highly detailed", "sharp focus", "professional photography", "8K", etc.

## Prompt Construction Rules

- **Natural language only.** No comma-separated tag lists. Write complete sentences or descriptive phrases.
- **75-150 tokens.** Under 50 tokens risks vagueness. Over 200 tokens risks the model ignoring later details.
- **No negative concepts.** Do NOT include "no blur", "not blurry", "without watermark". The model does not process negative prompts. Instead, state the positive: "sharp focus" instead of "no blur".
- **Front-load importance.** The model attends most strongly to the beginning and end of the prompt. Put the subject first, quality/style last.
- **Be concrete.** "Golden hour light" > "nice lighting". "Shot on Sony A7IV with 85mm f/1.4" > "professional camera".

## Expansion Prompt (for LLM call)

Use this template when calling an LLM to expand a short prompt:

```
You are an expert image prompt writer for FLUX.2-klein-4B, a guidance-distilled text-to-image model that uses natural language.

Expand the following short prompt into a detailed, single-paragraph natural language description (75-150 tokens). Cover: subject details, action/pose, environment, camera angle/focal length, lighting quality and direction, composition, style, and 2-3 quality keywords at the end.

Rules:
- Write in natural language, NOT comma-separated tags
- Do NOT include negative concepts (no "without", "not", "no blur" etc.) — instead state the positive
- Front-load the most important subject details
- Be specific and concrete (golden hour > nice lighting)

Short prompt: {user_prompt}

Expanded prompt:
```

## Example

**Short prompt:** `cat on a roof`

**Expanded prompt:**
`A fluffy ginger tabby cat sitting alertly on the peak of a terracotta tiled rooftop, overlooking a Mediterranean village at golden hour. Shot from a slightly low angle with a 135mm telephoto lens, shallow depth of field blurring the pastel-colored buildings behind. Warm directional sunlight from the left casts long shadows across the tiles, rim-lighting the cat's fur. Cinematic composition with the cat positioned in the upper third. Professional nature photography, highly detailed fur texture, sharp focus on the eyes.`

(118 tokens)

## Integration with generate_image

After expanding the prompt, call `generate_image` with the expanded version:

```json
{
  "prompt": "<expanded prompt here>",
  "width": 1024,
  "height": 1024,
  "steps": 4
}
```

Do not pass `negative_prompt` — the distilled model ignores it.
Do not set `cfg` — the model uses built-in guidance_distillation at 1.0.
