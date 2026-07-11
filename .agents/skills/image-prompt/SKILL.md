---
name: image-prompt
description: "MUST use when user says 'create a prompt', 'midjourney prompt',
             'niji prompt', 'image prompt', 'reference sheet for',
             or when user wants AI image generation prompts."
---

# Image Prompt Generation

## Activation
When this skill activates, output:
"Crafting an optimized image prompt..."

## Protocol

### Step 1: Parse Request
- Identify subject (what to depict)
- Identify mode (freeform or character)
- Check for style preferences

### Step 2: Select Composition
Choose shot type based on subject:
- Landscape/scene → extreme wide shot, panoramic
- Two characters interacting → medium shot
- Character reveal/power → full body, low angle
- Emotional moment → close-up, soft focus
- Action/combat → dynamic angle, motion blur

### Step 3: Build Prompt
Structure: `[subject], [composition], [lighting], [mood], [style], [quality flags]`

### Step 4: Output
Present prompt in a code block with model flag:
- Midjourney: `--v 7`
- NijiJourney: `--niji 7`

## Character Mode
If character profile exists in main memory, read appearance details and incorporate for consistent character art.

## Safety Check
Scan for flaggable terms before presenting. Replace if needed.

## Level History
- **Lv.1** — Base: Composition-aware prompt generation for any subject.
