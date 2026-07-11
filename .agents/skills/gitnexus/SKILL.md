---
name: gitnexus
description: "MUST use when working in ai-gm or ECD-website codebases,
              or when user says 'impact', 'blast radius', 'what depends on',
              'trace this call', 'graph query', 'rename this symbol',
              'architecture map', 'knowledge graph',
              or before any significant code change to check dependencies.
              Always available via MCP — loads automatically with agent."
---

# GitNexus — Code Knowledge Graph Integration

## Activation
When this skill activates, output:
"Loading GitNexus code graph..."

## Overview
GitNexus has indexed both code projects with their full dependency graphs.
Use its MCP tools instead of manual grep+read for relationship-aware queries.

## MCP Tools Quick Reference

| Tool | Input | Returns | Use Case |
|------|-------|---------|----------|
| `list_repos` | — | All indexed repos | Discover what's available |
| `query` | `query` string, optional `repo` | Ranked nodes with BM25 + semantic scores | Finding code by intent, cross-file search |
| `context` | `symbol` name, `repo` | Callers, callees, process participation, cluster | Full picture of a symbol's role |
| `impact` | `symbol` or `file` path, `repo` | Blast radius by depth (direct/indirect), confidence scores | "What breaks if I change this?" |
| `detect_changes` | git `diff` content or file list, `repo` | Affected processes, clusters, entry points | PR/diff impact assessment |
| `rename` | `oldName`, `newName`, optional `scope` | Affected files and their new content | Safe multi-file rename |
| `cypher` | `query` (Cypher), `repo` | Raw graph query results | Complex relationship analysis |

## Common Workflows

### Before a Code Change
```
impact({ symbol: "ChangedFunctionName" })
  → identifies all callers, including transitive ones
  → reveals risk: HIGH/MEDIUM/LOW
```

### Investigating a Bug
```
context({ symbol: "SuspectedFunction" })
  → returns: callers, callees, process involvement, cluster
  → saves reading 5+ files sequentially
```

### Understanding Architecture
```
# Read resources for high-level view:
gitnexus://repo/ai-gm/processes       → all execution flows
gitnexus://repo/ai-gm/clusters        → functional groupings
gitnexus://repo/ECD-website/processes → all execution flows
```

### Safe Rename
```
rename({ oldName: "OldName", newName: "NewName" })
  → handles all references across files via graph
  → no missed imports or dangling references
```

### Diff Impact Assessment
```
detect_changes({ diff: <git diff output>, repo: "ai-gm" })
  → maps changed lines to processes, clusters, entry points
  → use during code review quality gates
```

## Integration with Glitch Skills

| Glitch Skill | GitNexus Enhancement |
|-------------|---------------------|
| code-review | Run `impact` or `detect_changes` before Phase 1 to scope the review |
| debugging | Run `context` on the failing symbol in Phase 2 instead of manual search |
| refactoring | Run `context` + `impact` in Phase 1 to understand the symbol's reach |
| observation/survey | Use `query` for topic-based investigation, read `processes` resource |
| observation/audit | Use `cypher` for custom relationship queries, read `clusters` for module map |

## Mandatory Rules
1. Always specify `repo` parameter when multiple repos are indexed
2. GitNexus results augment (not replace) existing tools — use `read` for file contents, `grep` for text patterns
3. If GitNexus returns no results, fall back to standard grep+read workflow
4. The `context` tool is preferred over sequential grep for understanding symbol relationships

## Level History
- **Lv.1** — Base: Tool reference + common workflows + Glitch skill integration map.
