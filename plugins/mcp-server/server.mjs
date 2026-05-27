import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { Vault } from './vault.mjs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const vaultPath = resolve(__dirname, '.env.glitch');
  let vault;
  try {
    vault = await Vault.load(vaultPath);
    console.error(`[glitch-connector] Vault loaded from ${vaultPath}`);
    console.error(`[glitch-connector] Sections: ${vault.listSections().join(', ') || '(none)'}`);
  } catch (err) {
    console.error(`[glitch-connector] Failed to load vault at ${vaultPath}: ${err.message}`);
    console.error(`[glitch-connector] Create ${vaultPath} or check file permissions`);
    vault = null;
  }

  const plugins = [];
  const pluginFiles = ['env', 'api'];
  for (const name of pluginFiles) {
    try {
      const mod = await import(`./plugins/${name}.mjs`);
      plugins.push(mod.default || mod);
      console.error(`[glitch-connector] Loaded plugin: ${name}`);
    } catch (err) {
      console.error(`[glitch-connector] Failed to load plugin ${name}: ${err.message}`);
    }
  }

  const toolRegistry = new Map();
  for (const plugin of plugins) {
    if (plugin.tools && Array.isArray(plugin.tools)) {
      for (const tool of plugin.tools) {
        toolRegistry.set(tool.name, { plugin, toolDef: tool });
      }
    }
  }

  const server = new Server(
    { name: 'glitch-connector', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [];
    for (const [, { toolDef }] of toolRegistry) {
      tools.push({
        name: toolDef.name,
        description: toolDef.description,
        inputSchema: toolDef.inputSchema
      });
    }
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const entry = toolRegistry.get(name);
    if (!entry) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    try {
      return await entry.toolDef.handler(args || {}, vault);
    } catch (err) {
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, `Tool ${name} failed: ${err.message}`);
    }
  });

  server.onerror = (error) => console.error('[glitch-connector] MCP error:', error);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[glitch-connector] Server running on stdio');
}

process.on('SIGTERM', () => {
  console.error('[glitch-connector] SIGTERM received, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('[glitch-connector] SIGINT received, shutting down');
  process.exit(0);
});

main().catch((err) => {
  console.error('[glitch-connector] Fatal error:', err);
  process.exit(1);
});
