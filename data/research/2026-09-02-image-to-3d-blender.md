---
type: Research
title: Photo-to-3D House Model with AI + Blender
description: Research on recreating the "AI takes a photo of a building and generates a 3D model in Blender" workflow — pipelines, tooling, local feasibility on RTX 3070 (8GB).
date: 2026-09-02
---

# Research: Photo → 3D Model → Blender (AI-Driven)

**Question**: People online demo an AI taking a picture of a house/building and producing a full 3D model in Blender for rendering. How would we do this?

**Short answer**: This is a two-part pipeline — (1) an *image-to-3D AI model* generates a textured mesh (GLB) from the photo, and (2) *Blender MCP* (or plain Blender Python) lets an LLM insert, arrange, and render that model in Blender. Both halves run locally and free, and Blender MCP has documented **OpenCode support**, so Glitch itself can be the driving AI.

---

## Part 1 — How those demos actually work

The dominant community toolchain for "AI + Blender" is **blender-mcp** (26.7k GitHub stars), which the demos almost certainly use. It connects Blender to any LLM via a socket server inside Blender plus an MCP server:

- Components: a Blender addon (`addon.py`, in-Blender socket server) + MCP server (`src/blender_mcp/server.py`) communicating via JSON-over-TCP, port 9876 [blender-mcp README](https://github.com/ahujasid/blender-mcp)
- Capabilities include: create/modify/delete objects, materials, scene inspection, and **execute arbitrary Python in Blender** — meaning the LLM can import a generated GLB, build geometry procedurally, position cameras, and render.
- It has **built-in AI 3D model generation integrations**: Hyper3D Rodin and **Hunyuan3D** (API credentials stored in addon preferences or env vars) [blender-mcp Capabilities](https://github.com/ahujasid/blender-mcp#capabilities)
- It documents a demo workflow exactly matching what Troy described: *"Give a reference image, and create a Blender scene out of it"* ([linked demo video](https://www.youtube.com/watch?v=FDRb03XPiRo))
- **Crucially for us**: the README includes a documented **OpenCode MCP config**, so this plugs directly into Glitch's existing opencode setup:
  ```json
  { "mcp": { "blender-mcp": { "type": "local", "command": ["uvx", "blender-mcp"], "enabled": true } } }
  ```
  [blender-mcp OpenCode setup](https://github.com/ahujasid/blender-mcp#opencode)

So the demos are: LLM → blender-mcp → Blender Python; and the 3D model itself comes from an image-to-3D generator (Hunyuan3D hosted API through the addon, or a local model).

## Part 2 — The image-to-3D models (single photo → mesh)

Three mature open options, all output meshes importable into Blender (GLB/OBJ):

### Hunyuan3D 2.x (Tencent) — best quality, best Blender fit
- Two-stage: shape diffusion model (1.1B) → texture synthesis model (1.3B). Outperforms open and closed competitors in their evals [arxiv 2501.12202, repo](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)
- **VRAM: 6GB shape-only, 16GB shape+texture** — and ships a `--low_vram_mode` Gradio path plus 0.6B **mini/turbo** models and multiview (-mv) variants
- Windows/macOS/Linux supported
- Ships its **own official Blender addon** (`blender_addon.py`) driven by a local `api_server.py` — photo in, GLB directly into the open Blender scene [Hunyuan3D-2 Blender Addon](https://github.com/Tencent-Hunyuan/Hunyuan3D-2#blender-addon)
- Also works in **ComfyUI** via kijai's wrapper (prebuilt Windows wheels for cu126/py3.12) and ComfyUI-3D-Pack — we already run ComfyUI locally
- Confidence: HIGH (Tier 1, official repo, 14.7k stars)

### Microsoft TRELLIS — high quality, but heavy for our hardware
- Image-to-3D producing Gaussians, radiance fields, and meshes; exports textured GLB directly [TRELLIS repo](https://github.com/microsoft/TRELLIS)
- **Requires ≥16GB VRAM and is tested only on Linux** (Windows "not fully tested" per repo issue #3) — **does not fit our RTX 3070 8GB** locally; usable via the free HuggingFace Space demo instead
- Confidence: HIGH (Tier 1)

### TripoSR (Stability AI / Tripo) — fastest, lightest
- Single image → mesh in <0.5s (A100), default **~6GB VRAM**, MIT license, simple `python run.py photo.png` CLI, optional texture baking [TripoSR repo](https://github.com/VAST-AI-Research/TripoSR)
- Older and lower fidelity than Hunyuan3D/TRELLIS; good "does this even work?" smoke test
- Confidence: HIGH (Tier 1)

## Part 3 — The accuracy caveat for houses (important)

A **single photo** of a house gives the model only one view; the unseen sides are **hallucinated**. The result looks plausible in renders/turnarounds but is not dimensionally accurate. Two upgrades fix this:

1. **Multi-view input**: Hunyuan3D-2mv accepts multiple photos of the house for a conditioning-fused reconstruction; TRELLIS also supports multi-image conditioning. Quality scales with coverage.
2. **Photogrammetry instead of generative AI**: with ~30-80 overlapping photos around the building, **Meshroom** (AliceVision, free/opensource, native Windows binaries) reconstructs a dimensionally accurate, photographically textured mesh — no hallucination at all. It also has a Gaussian-splatting plugin (MrGSplat). Slower (tens of minutes) but this is the professional path for real buildings [Meshroom](https://github.com/alicevision/Meshroom)

Rule of thumb: AI generative = 1 photo, fast, aesthetic but invented backsides; photogrammetry = many photos, slow, geometrically truthful.

## Part 4 — Feasibility on our machine

- GPU verified: **RTX 3070, 8192 MiB VRAM** (`nvidia-smi`)
- **Fits**: Hunyuan3D shape-only (6GB), Hunyuan3D-2mini/turbo (0.6B), TripoSR (6GB), TRELLIS/Hunyuan full texture pipeline — NOT without cloud/offload
- Texture generation (the 16GB stage) options on 8GB: use Hunyuan3D `--low_vram_mode`, the HuggingFace free demo, blender-mcp's hosted Hunyuan3D API, or Blender's simple screenshot-based texture projection for houses (brick/siding = big flat surfaces, projects well)
- Blender MCP daemon needs `uv` (Windows installer: `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`), Blender ≥3.0

## Recommended build order

1. **Proof of concept (fastest, no GPU risk)**: install blender-mcp into Glitch's opencode config + Blender addon; use its built-in Hunyuan3D integration (or HF demo → download GLB) for generation; ask Glitch to import the GLB, scale/orient it, set lighting/camera, render. This replicates exactly what Troy saw online.
2. **Fully local generation**: install Hunyuan3D-2 API server (or ComfyUI-3D-Pack / kijai wrapper, reusing our existing ComfyUI) → photo → GLB → import via blender-mcp. Start with mini/shape-only for VRAM, upgrade later.
3. **Accuracy branch (real houses with walkaround photos)**: Meshroom pipeline → OBJ → Blender. Photogrammetry instead of generative hallucination.

## Confidence & Limitations

- All core claims from Tier 1 sources (official GitHub repos + arXiv). HIGH confidence.
- Not verified firsthand: exact VRAM behavior of Hunyuan3D `--low_vram_mode` on 8GB (repo says 6GB shape / 16GB full; low_vram claims unquantified); single-photo house quality is inherently model-dependent — expect to iterate.
- TRELLIS Windows support is community-led (issue #3), not official.

## Addendum (2026-09-02): Refined scope — 2.5D environment as video backdrop

Troy refined the goal: NOT a full 3D model — a photo → explorable 2.5D environment with slight camera parallax, used as a virtual video backdrop where the user composites themselves into the scene.

This is an EASIER problem than full image-to-3D. Options in order of effort:

1. **Depth-displacement 2.5D (classic "3D photo" effect)**: photo → **Depth Anything V2** (monocular depth, small models 24-335M params, runs trivially on 8GB, Apache-2.0 small / CC-BY-NC large) → displaced subdivided plane or layered cards in Blender → slight camera drift render → chroma-key the user in front. Inpainting (ComfyUI, already local) fills exposed gaps behind occluders. [Depth-Anything-V2](https://github.com/DepthAnything/Depth-Anything-V2), ComfyUI node: [ComfyUI-DepthAnythingV2](https://github.com/kijai/ComfyUI-DepthAnythingV2)
2. **Panorama world generation**: **HunyuanWorld 1.0** (Tencent) — image → 360° panorama → semantically-layered 3D world with mesh export + web viewer. Models are small (478MB PanoDiT); there's a quantized "lite" version targeting consumer GPUs (README cites 4090-class). Successors: WorldMirror (Oct 2025, video/multi-view in), WorldPlay (Dec 2025, real-time), HY-World-2.0 (Apr 2026). [HunyuanWorld-1.0](https://github.com/Tencent-Hunyuan/HunyuanWorld-1.0)
3. **Camera-projection mapping (fSpy + Blender)**: calibrate the photo's camera, project texture onto simple boxes/planes — most controllable result for architecture, no AI hallucination.
4. **Hosted one-click**: World Labs Marble (marble.worldlabs.ai verified live but JS-only page, details unverified); Luma/Polycam (need video capture, not single photo).

The video-software integration is standard compositing: render a subtle ambient camera-move loop from Blender, user films against green, key + composite in DaVinci/OBS.

## Sources

- https://github.com/ahujasid/blender-mcp (Blender MCP — LLM↔Blender socket bridge, Hunyuan3D integration, OpenCode config)
- https://github.com/Tencent-Hunyuan/Hunyuan3D-2 (image-to-3D model, Blender addon, API server, VRAM figures)
- https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1 (referenced successor, full OSS with PBR)
- https://github.com/microsoft/TRELLIS + https://arxiv.org/abs/2412.01506 (image/text-to-3D, 16GB VRAM, Linux-tested)
- https://github.com/VAST-AI-Research/TripoSR + https://arxiv.org/abs/2403.02151 (fast single-image reconstruction, ~6GB)
- https://github.com/kijai/ComfyUI-Hunyuan3DWrapper (ComfyUI integration, Windows prebuilt wheels)
- https://github.com/MrForExample/ComfyUI-3D-Pack (ComfyUI suite wrapping TripoSR/TRELLIS/Hunyuan3D/StableFast3D/InstantMesh, Windows prebuilds)
- https://github.com/alicevision/Meshroom (photogrammetry path, MrGSplat splat plugin)
