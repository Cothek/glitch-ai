import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export const tools = [
  {
    name: 'mcp_env',
    description: 'Get environment variables for a project section from the Glitch credential vault. Returns all key-value pairs for the given project name, optionally merged with an environment-specific override section.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project/section name from .env.glitch (e.g., "ai-gm", "ecd-website")'
        },
        env: {
          type: 'string',
          description: 'Optional environment override (e.g., "production", "development"). Merges [project:env] over [project]'
        }
      },
      required: ['project']
    },
    handler: async (args, vault) => {
      if (!vault) {
        throw new McpError(ErrorCode.InternalError, 'Credential vault not loaded — check .env.glitch exists');
      }

      const { project, env } = args;
      const result = vault.getEnv(project, env);

      if (!result) {
        const hint = env
          ? `Section [${project}] or [${project}:${env}] not found`
          : `Section [${project}] not found`;
        const available = vault.listSections();
        throw new McpError(
          ErrorCode.InvalidParams,
          `${hint}. Available sections: ${available.join(', ') || '(none)'}`
        );
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    }
  }
];
