## Available Tools (Bash-Accessible)

These CLI tools are available to you as a sub-agent. Use them to gather context, search memory, or check system state during your tasks.

### FTS5 Memory Search
Full-text search over the user's memory/chronicles using SQLite FTS5 with BM25 ranking.

Usage:
```
node glitch-memorycore/plugins/embed-search/search-memory.mjs -q "<your query>" --json
```

The `--json` flag returns machine-readable results with scores, file paths, and line numbers. Omit it for human-readable output.

Use this when you need context about:
- Past decisions or preferences
- Project history and architecture choices
- Configurations and setup details
- Patterns and recurring issues

### Image Storage Stats
Check how much space pasted images are using in the opencode database.

Usage:
```
node scripts/cleanup-opencode-images.mjs --stats
```

### GitNexus Code Graph (If Available)
If the project is an indexed repo (ai-gm, ECD-website), you can use GitNexus MCP tools directly:

- `query`: Search for code by intent
- `context`: 360-degree view of a symbol
- `impact`: Blast radius before changes
- `detect_changes`: What your changes affect
- `rename`: Coordinated multi-file rename

Type `impact` or `context` as a shell command when these tools are available.
