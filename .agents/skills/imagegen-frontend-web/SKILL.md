---
name: imagegen-frontend-web
description: "Image-generation skill for creating premium, conversion-aware website design reference images. Generates one separate horizontal image per section. Optimized for landing pages, marketing sites, and product comps that developers or coding models can accurately recreate."
argument-hint: "[sections: 1-12] [brief]"
---

# DISCLAIMER — Tool Dependency

This skill produces prompts and specifications for image-generation tools. It does NOT have a built-in image generator. To produce actual images, you need an external image-generation API or MCP server (Midjourney, DALL-E, Stable Diffusion, or similar). If no such tool is available, use this skill to generate text-based design references that a developer can recreate manually.

---

# HARD OUTPUT RULE — READ FIRST

**Generate one separate horizontal image PER section. Always. No exceptions.**

- 1 section requested -> 1 image
- 4 sections requested -> 4 images
- 8 sections requested -> 8 images
- 12 sections requested -> 12 images
- "landing page" with no count -> default to 6 sections -> 6 images
- "full website template" -> default to 8 sections -> 8 images

Each image is one section, generated as its own image call. Never combine multiple sections into one frame. Never return a single tall image that contains the whole page.

If you can only render one image at a time, output them sequentially in the same response, one after the other, until every section has its own image. Announce each one ("Section 1 of 8: Hero", "Section 2 of 8: Trust bar", etc.).

This rule overrides any model default that wants to collapse output into a single image.

---

# HERO COMPOSITION BIAS — READ FIRST

The default **left-text / right-image hero is the most overused AI pattern**. It is allowed, but it should not be your first instinct.

Before reaching for it, consider these alternatives and pick whichever fits the brand best:
- centered over background image
- bottom-left over image
- bottom-right over image
- top-left lead
- stacked center
- image-as-canvas
- off-grid editorial
- mini minimalist
- right-text / left-image (inverted classic)

Use left-text / right-image only when it is genuinely the strongest choice — not by default.

---

# CORE DIRECTIVE: AWWWARDS-LEVEL IMAGE ART DIRECTION
You are an elite frontend image art director.

Your job is not to generate generic AI art.
Your job is to generate highly creative, premium, frontend design reference images that feel like real high-end website concepts.

Standard image generation tends to collapse into repetitive defaults:
- centered dark hero
- purple/blue AI glow
- floating meaningless blobs
- generic dashboard card spam
- weak typography hierarchy
- cloned sections
- "luxury" that is just beige serif text
- "creative" that is actually messy and unreadable
- text-heavy layouts with not enough imagery
- overly dense sections with no breathing room

Your goal is to aggressively break these defaults.

The output must feel:
- art-directed
- premium
- visually memorable
- structured
- readable
- implementation-friendly
- clearly usable as a frontend reference

Do not generate random mood art unless explicitly asked.
Default to website design comps.

---

## 1. ACTIVE BASELINE CONFIGURATION

- DESIGN_VARIANCE: 8
  `(1 = rigid / symmetrical, 10 = artsy / asymmetric)`
- VISUAL_DENSITY: 4
  `(1 = airy / gallery-like, 10 = packed / intense)`
- ART_DIRECTION: 8
  `(1 = safe commercial, 10 = bold creative statement)`
- IMPLEMENTATION_CLARITY: 9
  `(1 = loose moodboard, 10 = very codeable UI reference)`
- IMAGE_USAGE_PRIORITY: 9
  `(1 = mostly typographic, 10 = strongly image-led)`
- SPACING_GENEROSITY: 8
  `(1 = compact / tight, 10 = very spacious / breathable)`
- LAYOUT_VARIATION: 8
  `(1 = same anchor repeats, 10 = bold composition variety across sections)`
- CONVERSION_DISCIPLINE: 8
  `(1 = pure art moodboard, 10 = clear funnel + premium design balance)`

AI Instruction:
Use these as global defaults unless the user clearly asks for something else.
Do not ask the user to edit this file.
Adapt these values dynamically from the prompt.

Interpretation:
- **Adaptation priority**: the user's brief always overrides defaults. Read the prompt carefully, then adjust dials, hero scale, background mode, gradient use, and composition variety to match — never force a recipe that contradicts the brief.
- If the user says "clean", reduce density and increase clarity.
- If the user says "crazy creative", increase variance and art direction.
- If the user says "premium SaaS", keep clarity high and art direction controlled.
- If the user says "editorial", allow stronger type and more asymmetry.
- Bias toward stronger visual concepts, not safe layouts — but never against the brief.
- Use imagery as a core design material — including as **full-bleed backgrounds**, not only as inline assets, **when the brief allows it**.
- Vary composition: do not default to "text left, image right". Move text to bottom-left, center, top-right, etc. across sections.
- Keep sections breathable. Do not over-pack the page.
- Prefer slightly more whitespace between sections than default.
- Stay conversion-aware: every section has a job (hook / proof / educate / convert).

### Brief-to-direction mapping
Read the brief. Then bias the picks like this:

If the user says **"minimalist" / "clean" / "typography-only" / "swiss" / "ultra simple"**:
- Hero Scale: Mini Minimalist
- Background Mode: solid surfaces, subtle texture, optional ONE color-blocked diptych
- Gradients: skip or use only the softest tonal gradient
- Composition: stacked center, generous negative space
- Skip the "must include full-bleed" rule

If the user says **"editorial" / "magazine" / "art-directed" / "fashion"**:
- Hero Scale: Mid Editorial or Giant Statement
- Background Mode: editorial side-image, duotone treated image, atmospheric photo grade
- Gradients: subtle tonal grades only
- Composition: off-grid editorial offset, asymmetric pulls
- Strong typography contrast

If the user says **"cinematic" / "atmospheric" / "premium" / "luxury" / "bold"**:
- Hero Scale: Giant Statement
- Background Mode: full-bleed image with tonal overlay, soft radial vignette + product, micro-noise gradient
- Gradients: cinematic palette-matched welcomed
- Composition: bottom-left over background image, centered low, image-as-canvas

If the user says **"SaaS" / "product" / "dashboard" / "fintech" / "infra"**:
- Hero Scale: Mid Editorial
- Background Mode: solid + inline asset, flat block + detail crop, occasional editorial side-image
- Gradients: very subtle, palette-matched only
- Composition: clear product framing, trust-driven anchors
- Slightly higher implementation clarity

If the user says **"agency" / "creative studio" / "portfolio"**:
- Hero Scale: Giant Statement OR Mini Minimalist (decisive)
- Background Mode: vary boldly (full-bleed image, color-blocked diptych, duotone)
- Gradients: editorial color washes acceptable
- Composition: off-grid, poster-like

If the user says **"e-commerce" / "shop" / "store" / "product page"**:
- Hero Scale: Mid Editorial with strong product focus
- Background Mode: full-bleed product photo, soft radial vignette + crop, flat block + detail
- Gradients: subtle, never competing with product
- Composition: product-led; CTAs unmistakable

If the brief is silent on style:
- Use defaults with confident background variety
- Pick one Hero Scale decisively, do not split the difference

Never force backgrounds, gradients, or full-bleed treatments where the brief asks for restraint. Never strip them out where the brief asks for atmosphere.

---

## 2. THE COMBINATORIAL VARIATION ENGINE
To avoid repetitive AI-looking output, internally choose one option from each category based on the prompt and commit to it consistently.

Do not mash everything together into chaos.
Pick a strong combination and execute it clearly.

### Theme Paradigm
Choose 1:
1. Pristine Light Mode — Off-white / cream / paper tones, sharp dark text, editorial confidence.
2. Deep Dark Mode — Charcoal / graphite / zinc, elegant glow only when justified.
3. Bold Studio Solid — Strong controlled color fields like oxblood, royal blue, forest, vermilion, or emerald with crisp contrasting UI.
4. Quiet Premium Neutral — Bone, sand, taupe, stone, smoke, muted contrast, restrained luxury.

### Background Character
Choose 1:
1. Subtle technical grid / dotted field
2. Pure solid field with soft ambient gradient depth
3. Full-bleed cinematic imagery with proper contrast control
4. Quiet textured paper / material / tactile surface feel

### Typography Character
Choose 1:
1. Satoshi-like clean grotesk
2. Neue-Montreal-like refined grotesk
3. Cabinet / Clash-like expressive display
4. Monument-like compressed statement typography
5. Elegant editorial serif + sans pairing
6. Swiss rational sans with very strong hierarchy

### Hero Architecture
Choose 1:
1. Cinematic Centered Minimalist
2. Asymmetric Split Hero
3. Floating Polaroid Scatter
4. Inline Typography Behemoth
5. Editorial Offset Composition
6. Massive Image-First Hero with restrained text

### Section System
Choose 1 dominant structure:
1. Strict modular bento rhythm
2. Alternating editorial blocks
3. Poster-like stacked storytelling
4. Gallery-led visual cadence
5. Swiss grid discipline
6. Asymmetric premium marketing flow

### Signature Component Set
Choose exactly 4 unique components:
- Diagonal Staggered Square Masonry
- 3D Cascading Card Deck
- Hover-Accordion Slice Layout
- Pristine Gapless Bento Grid
- Infinite Brand Marquee Strip
- Turning Polaroid Arc
- Vertical Rhythm Lines
- Off-Grid Editorial Layout
- Product UI Panel Stack
- Split Testimonial Quote Wall
- Oversized Metrics Strip
- Layered Image Crop Frames

### Motion-Implied Language
Choose exactly 2:
- scrubbing text reveal energy
- pinned narrative section energy
- staggered float-up energy
- parallax image drift energy
- smooth accordion expansion energy
- cinematic fade-through energy

### Composition Anchor (per-section)
Each section picks 1 anchor; across the site at least 3 different anchors must appear.
- Centered statement
- Top-left lead, support bottom-right
- Bottom-left text over background image
- Bottom-right CTA cluster
- Left-third caption + right-two-thirds visual (use sparingly, never twice in a row)
- Right-third caption + left-two-thirds visual (inverted classic)
- Centered low (text in lower 40% over hero image)
- Off-grid editorial offset (asymmetric pull)
- Stacked center (label / headline / sub / CTA all centered, ultra minimalist)
- Image-as-canvas with text overlaid in a clean safe area

### Background Mode (per-section)
Pick 1 per section; vary across the page so it is never all the same mode.
- Solid surface with inline asset
- Subtle texture / paper / grid as background
- Full-bleed image background with tonal overlay
- Editorial side-image (50/50, 60/40, 40/60 — invertible)
- Image as the entire visual + text overlaid in a clean safe area
- Flat color block + small product / detail crop as accent
- Cinematic tonal gradient (palette-matched, low chroma, professional)
- Atmospheric photo with strong color grade
- Duotone treated image (two-color photo treatment, palette-locked)
- Soft radial vignette + product crop
- Micro-noise gradient over solid
- Color-blocked diptych (two flat fields meeting, modernist)

### CTA Variation
Pick the CTA style that fits each section:
- Classic primary pill
- Outline / ghost
- Underlined inline link with arrow
- Banner-style full-width CTA
- Oversized headline + tiny CTA hint
- CTA as caption under a strong visual

### Hero Scale (per-page)
Pick 1 — must match brand mood:
- Giant Statement Hero (massive type, large image, dominant first viewport)
- Mid Editorial Hero (balanced type/image, cinematic but not screen-filling)
- Mini Minimalist Hero (tiny logo + short statement + thin CTA, almost no image, lots of negative space)

### Narrative / Concept Spine
Pick 1 and let it thread through visuals and short copy across the page.
- Artifact / collectible
- Journey / pilgrimage
- Tool / precision instrument
- Living system / garden
- Stage / spotlight
- Archive / dossier

### Second-Read Moment
Pick exactly 1 unobvious but legible motif and place it deliberately, once across the page:
- asymmetric bleed that still respects hierarchy
- one oversized punctuation or numeral serving structure
- a single unexpected material switch (paper vs gloss vs metal accent)
- a narrow vertical side-rail editorial note style
- a macro crop that carries brand color naturally

---

## 3. FRONTEND REFERENCE RULE
Every generated image must clearly communicate:
- layout
- section hierarchy
- spacing
- typography scale
- visual rhythm
- CTA priority
- component styling
- image treatment
- overall design system

A developer or coding model should be able to look at the image and understand how to build it.

Do not produce vague abstract artwork when the request is for frontend.

---

## 4. HERO MINIMALISM RULES
The hero must feel cinematic, clear, and intentional.

### Absolute Hero Rules
- the hero must feel like a strong opening scene
- keep the hero composition clean
- do not overcrowd the first viewport
- the main headline must feel short and powerful
- headline should usually read like 5-10 strong words
- keep supporting text concise
- prioritize negative space and contrast
- avoid stuffing the hero with pills, fake stats, badges, tiny logos, and nonsense detail

### Graphic Restraint
Do not default to:
- giant meaningless outline numbers
- cheap SVG-looking filler graphics
- generic AI blobs
- random orb clutter

Use:
- typography
- image crops
- real layout tension
- premium materials
- strong framing

---

## 5. IMAGE COUNT & PAGE SLICING

### THIS IS THE PRIMARY OUTPUT RULE
Generate **one separate horizontal image PER section**. Always.

- never combine multiple sections in a single image
- never return a single tall slice that contains the whole page
- never return one "best" image and skip the rest

If ambiguous about section count, **default high**:
- "hero" -> 1 image
- "landing page" / "site template" -> default to 6 sections -> 6 images
- "full website" -> default to 8 sections -> 8 images
- "marketing site" -> default to 8 sections -> 8 images
- "product page" -> default to 6 sections -> 6 images
- "portfolio" -> default to 6 sections -> 6 images

### Format
- Always horizontal (16:9, 16:10, or 21:9 depending on density)
- Each image renders one focused section in high fidelity

### Continuity Rule
Across all per-section images, enforce one brand world:
- same palette and accent logic
- same typography family and scale
- same CTA family
- same border radius language
- same image treatment
- same tonal voice

---

## 6. CREATIVITY ESCALATION RULE
The design must show real creative ambition.

Actively increase at least 3 of these:
- stronger composition
- more distinctive typography
- more confident scale contrast
- more memorable hero concept
- more interesting image treatment
- more expressive section rhythm
- more original framing / cropping
- more art-directed visual tension
- more surprising but clear layout structure

Creativity must feel intentional, not chaotic.

---

## 7. IMAGE-FIRST ART DIRECTION
This skill must actively use images. Images are not optional decoration. Images are a core part of the frontend design language.

Strongly prefer:
- art-directed photography
- product imagery
- editorial imagery
- image crops
- framed image panels
- layered image compositions
- image-led hero sections
- image-supported storytelling blocks

---

## 8. ANTI-AI-SLOP RULES

### Layout slop
- endless centered sections
- identical card rows repeated section after section
- cloned left-text/right-image blocks
- perfect but lifeless symmetry everywhere

### Visual slop
- default purple/blue AI gradients
- too many glowing edges
- floating spheres / blobs everywhere
- glassmorphism stacked without reason
- over-rendered noise that hides the layout

### Typography slop
- giant heading + weak tiny subcopy
- too many font moods in one page
- lazy all-caps everywhere
- gradient headline as shortcut for "premium"

### Content slop
Ban generic copy like: unleash, elevate, revolutionize, next-gen, seamless, powerful solution, transformative platform.
Avoid fake brand slop: Acme, Nexus, Flowbit, Quantumly, NovaCore.

### Carousel / marquee slop
- infinity logo strips repeating the same 6 blobs
- "trusted by" ticker with unreadable mosquito logos

---

## 9. TYPOGRAPHY-FIRST DISCIPLINE
Typography is not filler. Typography is a primary design material.

Always ensure:
- clear size contrast
- obvious reading order
- strong display moments
- supporting text that is readable and brief

---

## 10. SECTION RHYTHM RULE
Vary section rhythm across the page by changing:
- density
- image-to-text ratio
- alignment
- scale
- whitespace
- card grouping
- background intensity
- visual tempo

---

## 11. COLOR & MATERIAL RULES

### Palette Discipline
Use one controlled palette across the entire site:
- 1 primary (brand anchor)
- 1 secondary (supporting tone)
- 1 accent (used sparingly for CTA / highlight)
- a neutral scale (background, surface, text, hairline)

### Gradient Discipline
Allowed (use confidently):
- low-chroma palette-matched tonal gradients
- single-hue atmospheric grades behind hero photography
- soft vignettes and radial depth
- noise-textured gradients adding tactile depth

Banned (AI gradient slop):
- rainbow / mesh blob gradients
- purple-to-blue "AI" defaults
- pink-to-orange "creator" defaults
- neon edges and glow halos with no purpose
- gradient text as a shortcut for "premium"

---

## 12. DEFAULT SITE PACKS

### 4-section pack
Hero → Features → Social proof → CTA

### 8-section pack
Hero → Trust bar → Features → Product showcase → Benefits → Testimonials → Pricing → CTA

### 12-section pack
Hero → Trust bar → Feature grid → Product preview → Problem/solution → Benefits → Workflow → Metrics → Testimonials → Pricing → FAQ → CTA + footer

---

## 13. CLARITY CHECK
Before finalizing, verify internally:
1. Is the hierarchy obvious?
2. Is the hero clean enough?
3. Is the design visually distinctive?
4. Is it free of obvious AI tells?
5. Can someone code from this?
6. If multiple images exist, do they clearly belong together?
7. Is imagery used strongly enough?
8. Does the page breathe?
9. Is the hero using a varied composition (not default left-text/right-image)?
10. Is the total number of images equal to the number of sections?

---

## 14. RESPONSE BEHAVIOR
When the user asks for a frontend design:
1. infer site type and primary conversion goal
2. infer number of sections (if unclear, use defaults from §5)
3. announce section count ("Generating N horizontal images, one per section")
4. plan ONE horizontal image PER section
5. choose Hero Scale for the whole site
6. choose a strong visual combination
7. for each section: pick a Composition Anchor, Background Mode, and CTA Variation
8. enforce hero minimalism + section size variety
9. lock one consistent palette across all images
10. keep spacing generous, even, and clean
11. remove AI slop
12. run the Clarity Check
13. generate every per-section horizontal image, labeled "Section X of N: <name>"

---

*Ported from taste-skill (Leonxlnx/taste-skill, MIT License)*
