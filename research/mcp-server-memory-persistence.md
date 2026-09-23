# Building an MCP Server for Memory/Persistence in Cline

**Research Date:** 2026-09-17  
**Sources:** Primary documentation from modelcontextprotocol.io, GitHub repos, SDK source code  
**Confidence:** HIGH (all claims sourced from Tier 1 official docs/specs)

---

## 1. MCP Protocol Specification for Building a Server

**Source:** [modelcontextprotocol.io/specification/2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26)

MCP is an open protocol using **JSON-RPC 2.0** messages for communication between:

- **Hosts**: LLM applications that initiate connections (e.g., Cline)
- **Clients**: Connectors within the host application
- **Servers**: Services that provide context and capabilities

### Server Capabilities

Servers can expose three core features:

1. **Tools** — Functions the LLM can invoke (model-controlled)
2. **Resources** — File-like data that can be read by clients (user or AI-controlled)
3. **Prompts** — Pre-written templates for user tasks

### Tool Registration (from spec)

```json
{
  "capabilities": {
    "tools": {
      "listChanged": true
    }
  }
}
```

### Tool Protocol Messages

**Listing tools** — client sends `tools/list`, server returns tool definitions with name, description, and JSON Schema input:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": { "cursor": "optional-cursor-value" }
}
```

**Calling tools** — client sends `tools/call` with arguments:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": { "location": "New York" }
  }
}
```

**Tool results** return content items (text, image, audio, or embedded resources):

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [{ "type": "text", "text": "Weather data..." }],
    "isError": false
  }
}
```

### Tool Annotations

Tools can declare behavioral hints:
- `readOnlyHint` — tool doesn't modify state
- `destructiveHint` — tool may destructively modify data
- `idempotentHint` — safe to retry with same args
- `openWorldHint` — tool interacts with external/open world

---

## 2. How Cline Connects to MCP Servers

**Source:** [github.com/cline/cline README](https://github.com/cline/cline)

Cline is "the open source coding agent in your IDE, terminal, & desktop." From the README:

> Extend Cline's capabilities with plugins... or use [MCPs](https://github.com/modelcontextprotocol) to connect to databases, query APIs, manage cloud infrastructure, and interact with external systems. Use [community-built servers](https://github.com/modelcontextprotocol/servers) or ask Cline to create custom tools on the fly.

### Configuration

Cline uses the same `mcpServers` JSON configuration format as Claude Desktop. From the MCP servers repo README:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

On Windows:
```json
{
  "mcpServers": {
    "memory": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

Cline also supports environment variables for MCP servers:
```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "env": {
        "MEMORY_FILE_PATH": "/path/to/custom/memory.jsonl"
      }
    }
  }
}
```

### CLI Management

Cline CLI can manage MCP servers directly:
```bash
cline mcp
```

---

## 3. MCP Tools That Can Be Exposed to Cline

**Source:** [modelcontextprotocol.io/specification/2025-03-26/server/tools](https://modelcontextprotocol.io/specification/2025-03-26/server/tools)

MCP tools are **model-controlled** — the LLM discovers and invokes them automatically. Any tool the server registers is available to Cline's agent.

### Existing Reference Servers (from modelcontextprotocol/servers)

| Server | Purpose |
|--------|---------|
| **Memory** | Knowledge graph-based persistent memory |
| **Filesystem** | Secure file operations with access controls |
| **Git** | Read, search, manipulate Git repos |
| **Fetch** | Web content fetching |
| **Sequential Thinking** | Problem-solving through thought sequences |
| **Time** | Timezone conversion |

### Custom Tool Capabilities

You can expose arbitrary tools, including:
- Database queries (read/write)
- API calls to external services
- Filesystem operations
- Compute/processing functions
- Any programmatic capability the server can perform

---

## 4. Persistent State Across Sessions

**YES** — MCP servers can provide persistent state. The official **Memory** server demonstrates this.

**Source:** [github.com/modelcontextprotocol/servers/src/memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)

### How the Memory Server Persists State

The memory server stores a knowledge graph as a **JSONL file** on the local filesystem:

```typescript
// From memory/index.ts
export const defaultMemoryPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)), 
  'memory.jsonl'
);

// Custom path via environment variable
if (process.env.MEMORY_FILE_PATH) {
  const customPath = expandHome(process.env.MEMORY_FILE_PATH);
  return path.isAbsolute(customPath)
    ? customPath
    : path.join(path.dirname(fileURLToPath(import.meta.url)), customPath);
}
```

### Persistence Mechanisms

1. **File-based persistence** — Data written to `.jsonl` files on disk, survives restarts
2. **Atomic writes** — Uses temp file + rename for crash safety:
   ```typescript
   await fs.writeFile(tempFilePath, lines.join("\n") + "\n");
   await fs.rename(tempFilePath, this.memoryFilePath);
   ```
3. **Mutation queue** — Serializes concurrent mutations to prevent corruption:
   ```typescript
   private mutationQueue: Promise<unknown> = Promise.resolve();
   
   private async withLock<T>(operation: () => Promise<T>): Promise<T> {
     const result = this.mutationQueue.then(operation, operation);
     this.mutationQueue = result.then(() => undefined, () => undefined);
     return result;
   }
   ```

### Data Model

The knowledge graph uses three primitives:
- **Entities** — Named nodes with type and observations
- **Relations** — Directed connections between entities
- **Observations** — Atomic facts attached to entities

```typescript
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}
```

---

## 5. Simplest MCP Server Implementation

**Source:** [modelcontextprotocol.io/quickstart/server](https://modelcontextprotocol.io/quickstart/server), [TypeScript SDK README](https://github.com/modelcontextprotocol/typescript-sdk)

### Minimal TypeScript Server (from SDK README)

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'greeting-server', version: '1.0.0' });

server.registerTool(
    'greet',
    {
        description: 'Greet someone by name',
        inputSchema: z.object({ name: z.string() })
    },
    async ({ name }) => ({
        content: [{ type: 'text', text: `Hello, ${name}!` }]
    })
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main();
```

### Setup

```bash
npm install @modelcontextprotocol/server zod
```

### Minimal Python Server (from quickstart)

```python
from mcp.server import MCPServer

mcp = MCPServer("my-server")

@mcp.tool()
async def greet(name: str) -> str:
    """Greet someone by name.
    
    Args:
        name: The person's name
    """
    return f"Hello, {name}!"

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

```bash
uv add "mcp[cli]"
```

### Key Requirements

- **STDIO servers**: Never use `console.log()` or `print()` — these write to stdout and corrupt JSON-RPC messages. Use `console.error()` or `logging` to stderr.
- **Transport**: `StdioServerTransport` for CLI-based servers (used by Cline)
- **Schema validation**: Use Zod (TS) or type hints (Python) for input schemas

---

## 6. Existing Memory/Persistence MCP Servers

**Source:** [github.com/modelcontextprotocol/servers/src/memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)

### Official Memory Server

Published as `@modelcontextprotocol/server-memory` on npm.

**Tools provided:**

| Tool | Description |
|------|-------------|
| `create_entities` | Create new nodes in the knowledge graph |
| `create_relations` | Create directed connections between entities |
| `add_observations` | Add facts to existing entities |
| `delete_entities` | Remove entities and their relations |
| `delete_observations` | Remove specific facts |
| `delete_relations` | Remove connections |
| `read_graph` | Read the entire knowledge graph |
| `search_nodes` | Search by name, type, or observation content |
| `open_nodes` | Retrieve specific nodes by name |

**Resources:**
- `memory://knowledge-graph` — Full graph as JSON, subscribable for live updates

**Usage with Cline:**
```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "env": {
        "MEMORY_FILE_PATH": "./cline-memory.jsonl"
      }
    }
  }
}
```

### Other Persistence Options

From the reference servers list:
- **Filesystem** (`@modelcontextprotocol/server-filesystem`) — Direct file read/write with access controls
- **SQLite** (archived) — Database interaction
- **Redis** (archived) — Key-value store

---

## 7. Cline's MCP Integration with Its Agent System

**Source:** [cline/cline README](https://github.com/cline/cline)

### Architecture

Cline operates as an AI coding agent with multiple integration points:

1. **MCP servers** are launched as child processes (typically via stdio transport)
2. The agent **discovers tools** via `tools/list` at connection
3. Tools are **presented to the LLM** as available functions
4. The LLM **invokes tools** via `tools/call` with human-in-the-loop approval
5. Results flow back to the LLM for further reasoning

### Multi-Agent Teams

From the README:
> Coordinate multiple agents working together on complex tasks. A coordinator agent breaks the work into subtasks and delegates to specialist agents, each with their own tools and context. Team state persists across sessions.

```bash
cline --team-name auth-sprint "Plan and implement user authentication with tests"
```

### Plugin System (SDK)

```typescript
import { Agent, createTool } from "@cline/sdk"

const deployTool = createTool({
  name: "deploy",
  description: "Deploy the current branch to staging.",
  inputSchema: { type: "object", properties: { env: { type: "string" } }, required: ["env"] },
  execute: async (input) => {
    // your deployment logic
  },
})

const agent = new Agent({ tools: [deployTool], /* ... */ })
```

MCP servers complement the plugin system by providing external tool integration without writing TypeScript code.

---

## 8. Filesystem Access via MCP

**YES** — MCP tools can read/write files on the local filesystem.

**Source:** [github.com/modelcontextprotocol/servers/src/filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)

### Filesystem Server Tools

| Tool | Description |
|------|-------------|
| `read_text_file` | Read file contents as text |
| `read_media_file` | Read binary files (images, audio) as base64 |
| `read_multiple_files` | Batch read multiple files |
| `write_file` | Create or overwrite files |
| `edit_file` | Selective edits with diff preview |
| `create_directory` | Create directories recursively |
| `list_directory` | List directory contents |
| `directory_tree` | Recursive JSON tree of directory |
| `move_file` | Move/rename files |
| `search_files` | Glob-pattern file search |
| `get_file_info` | File metadata (size, dates, permissions) |
| `list_allowed_directories` | Show accessible directories |

### Access Control

The filesystem server uses a directory allowlist:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/username/Desktop",
        "/path/to/other/allowed/dir"
      ]
    }
  }
}
```

From the filesystem README:
> The server's directory access control follows this flow:
> 1. Server starts with directories from command-line arguments
> 2. Client connects and sends `initialize` request with capabilities
> 3. If client supports roots protocol, server requests roots dynamically
> 4. All filesystem operations are restricted to allowed directories

---

## Recommendations for Building a Memory MCP Server for Cline

### Option A: Use the Official Memory Server (Simplest)

```json
{
  "mcpServers": {
    "memory": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-memory"],
      "env": {
        "MEMORY_FILE_PATH": "./data/cline-memory.jsonl"
      }
    }
  }
}
```

### Option B: Build a Custom Server with Enhanced Features

Based on the research, a custom memory server could extend the official one with:

1. **Richer data model** — Add timestamps, categories, importance scores
2. **Search improvements** — Full-text search, semantic similarity
3. **Session management** — Track which memories were created in which session
4. **Auto-summarization** — Periodically consolidate observations
5. **Context injection** — Automatically surface relevant memories at session start

### Minimum Viable Server

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { promises as fs } from 'fs';
import path from 'path';

const MEMORY_FILE = process.env.MEMORY_FILE_PATH || './memory.jsonl';

const server = new McpServer({ name: 'glitch-memory', version: '1.0.0' });

async function loadMemory(): Promise<any[]> {
  try {
    const data = await fs.readFile(MEMORY_FILE, 'utf-8');
    return data.split('\n').filter(l => l.trim()).map(JSON.parse);
  } catch { return []; }
}

async function saveMemory(entries: any[]): Promise<void> {
  await fs.writeFile(MEMORY_FILE, entries.map(JSON.stringify).join('\n') + '\n');
}

server.registerTool(
  'store_memory',
  {
    description: 'Store a piece of information for future reference',
    inputSchema: z.object({
      key: z.string(),
      content: z.string(),
      category: z.string().optional()
    })
  },
  async ({ key, content, category }) => {
    const memories = await loadMemory();
    memories.push({ key, content, category, timestamp: Date.now() });
    await saveMemory(memories);
    return { content: [{ type: 'text', text: `Stored: ${key}` }] };
  }
);

server.registerTool(
  'recall_memory',
  {
    description: 'Retrieve stored information by key or category',
    inputSchema: z.object({
      query: z.string(),
      category: z.string().optional()
    })
  },
  async ({ query, category }) => {
    const memories = await loadMemory();
    const matches = memories.filter(m => {
      const matchesQuery = m.key.includes(query) || m.content.includes(query);
      const matchesCategory = !category || m.category === category;
      return matchesQuery && matchesCategory;
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }]
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
```

---

## Source List

| Source | Tier | URL |
|--------|------|-----|
| MCP Specification | Tier 1 | https://modelcontextprotocol.io/specification/2025-03-26 |
| MCP Server Quickstart | Tier 1 | https://modelcontextprotocol.io/quickstart/server |
| MCP Tools Spec | Tier 1 | https://modelcontextprotocol.io/specification/2025-03-26/server/tools |
| MCP TypeScript SDK | Tier 1 | https://github.com/modelcontextprotocol/typescript-sdk |
| MCP Servers Repo | Tier 1 | https://github.com/modelcontextprotocol/servers |
| Memory Server Source | Tier 1 | https://github.com/modelcontextprotocol/servers/tree/main/src/memory |
| Memory Server Index.ts | Tier 1 | https://raw.githubusercontent.com/modelcontextprotocol/servers/main/src/memory/index.ts |
| Filesystem Server Source | Tier 1 | https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem |
| Filesystem Server Index.ts | Tier 1 | https://raw.githubusercontent.com/modelcontextprotocol/servers/main/src/filesystem/index.ts |
| Cline README | Tier 1 | https://github.com/cline/cline |

---

## Confidence & Limitations

**Confidence:** HIGH — All technical claims sourced from Tier 1 official documentation and source code.

**Limitations:**
- Cline's internal MCP client implementation details are not fully public (source exists but wasn't deeply explored)
- The official Memory server uses a simple JSONL format — no indexing for large datasets
- No official documentation found specifically about Cline's MCP lifecycle management
- The 2026-07-28 spec (v2 SDK) is newer than the 2025-03-26 spec fetched — some details may differ
