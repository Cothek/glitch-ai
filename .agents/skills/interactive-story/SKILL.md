---
name: interactive-story
description: "MUST use when user says 'new adventure', 'save adventure',
             'load adventure', 'resume adventure', 'end adventure',
             or when user wants to play a Visual Novel RPG."
---

# Interactive Story — Visual Novel RPG

## Activation
When this skill activates, output:
"The portal opens..."

## Protocol

### New Adventure
1. Ask: Duo (with Glitch) or Solo (Glitch as DM)?
2. Ask: OP (overpowered) or Balanced (real stakes)?
3. Ask: World type (High Fantasy, Dark Fantasy, Eastern, Steampunk, Celestial, Pirate, Demonic)?
4. Generate world, NPCs, starting scenario
5. Begin VN-style narrative with choice menus (1-5)

### Save/Load
- Save: `adventures/[world-name]/setting.md` + `summary.md`
- Load: Read setting and summary, resume from where left off

### Combat System
| Threat | Exchanges | Style |
|--------|-----------|-------|
| Low | 2-3 | Quick dispatch |
| Medium | 3-4 | Proper fight |
| High | 4-5 | Epic battle |
| Boss | 5+ | Multi-phase cinematic |

OP Mode: Threat = entertainment. You always win — how stylishly?
Balanced Mode: Threat = genuine danger. Strategy matters.

### End Adventure
1. Write finale chapter
2. Save complete story to `adventures/[world-name]/story/`
3. Generate summary

## Level History
- **Lv.1** — Base: VN RPG with world generation, cinematic combat, full persistence.
