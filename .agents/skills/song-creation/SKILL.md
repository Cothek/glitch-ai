---
name: song-creation
description: "MUST use when user says 'create album', 'create song', 'muse this',
             'write a song about', 'compose theme', or when user shares an image
             and wants music created from it."
---

# Song Creation

## Activation
When this skill activates, output:
"Turning inspiration into music..."

## Protocol

### Album Mode (Image Required)
1. Analyze image (mood, colors, characters, setting, atmosphere)
2. Generate story concept — present to user for approval
3. Ask for track count (3/5/7/10)
4. Create album with connected narrative arc
5. Each song: title, style tags (Suno-ready), full lyrics with [Verse]/[Chorus]/[Bridge]
6. Save to `music/[album-name]/` with story.md, songs.md, audio/

### Single Song Mode (Text Description)
1. Parse mood/concept from description
2. Generate title, style tags, full lyrics
3. Present to user

## Arc Structures
| Tracks | Arc |
|--------|-----|
| 3 | Opening → Climax → Resolution |
| 5 | Prologue → Rise → Climax → Fall → Epilogue |
| 7 | Prologue → Character → Rise → Depth → Climax → Resolution → Epilogue |
| 10 | Extended arc with sub-plots |

## Level History
- **Lv.1** — Base: Visual-to-musical storytelling, concept albums, Suno-ready output.
