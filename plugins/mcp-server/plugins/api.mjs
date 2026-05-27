import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export const tools = [
  {
    name: 'mcp_api',
    description: 'Call a REST API endpoint using stored credentials from the Glitch credential vault. Supports bearer token, basic auth, API key in header/query, and unauthenticated requests. Returns the response body.',
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Named service from .env.glitch (e.g., "stripe", "github"). The vault must have a [service-name] section with BASE_URL and auth config.'
        },
        endpoint: {
          type: 'string',
          description: 'API endpoint path (e.g., "/v1/products", "/user"). Can start with / or not.'
        },
        method: {
          type: 'string',
          description: 'HTTP method: GET, POST, PUT, PATCH, DELETE',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
          default: 'GET'
        },
        body: {
          type: 'object',
          description: 'Optional request body (for POST/PUT/PATCH). Will be JSON-serialized.',
          additionalProperties: true
        },
        headers: {
          type: 'object',
          description: 'Additional headers to merge with defaults. Overrides auto-generated auth headers if same key.',
          additionalProperties: { type: 'string' }
        }
      },
      required: ['service', 'endpoint']
    },
    handler: async ({ service, endpoint, method = 'GET', body, headers = {} }, vault) => {
      if (!vault) {
        throw new McpError(ErrorCode.InternalError, 'Credential vault not loaded — check .env.glitch exists');
      }

      const config = vault.getSection(service);
      if (!config) {
        const available = vault.listSections();
        throw new McpError(
          ErrorCode.InvalidParams,
          `Service [${service}] not found. Available sections: ${available.join(', ') || '(none)'}`
        );
      }

      if (!config.BASE_URL) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Service [${service}] missing BASE_URL`
        );
      }

      if (!/^https?:\/\//.test(config.BASE_URL)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Service [${service}] has invalid BASE_URL — must start with http:// or https://`
        );
      }

      const baseUrl = config.BASE_URL.endsWith('/') ? config.BASE_URL.slice(0, -1) : '';
      const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
      let url = baseUrl + path;

      const authHeaders = {};
      const authType = config.AUTH_TYPE || (config.AUTH_TOKEN ? 'bearer' : 'none');

      switch (authType) {
        case 'bearer':
          authHeaders['Authorization'] = `Bearer ${config.AUTH_TOKEN}`;
          break;
        case 'basic': {
          const token = config.AUTH_TOKEN || '';
          const colonIndex = token.indexOf(':');
          if (colonIndex === -1) {
            throw new McpError(ErrorCode.InvalidParams, `AUTH_TOKEN for basic auth must be in format "username:password"`);
          }
          const username = token.substring(0, colonIndex);
          const password = token.substring(colonIndex + 1);
          const credentials = Buffer.from(`${username}:${password}`).toString('base64');
          authHeaders['Authorization'] = `Basic ${credentials}`;
          break;
        }
        case 'api-key-header': {
          const keyName = config.API_KEY_NAME || 'X-API-Key';
          authHeaders[keyName] = config.API_KEY_VALUE || '';
          break;
        }
        case 'api-key-query': {
          const keyName = config.API_KEY_NAME || 'api_key';
          const keyValue = config.API_KEY_VALUE || '';
          const separator = url.includes('?') ? '&' : '?';
          url += `${separator}${encodeURIComponent(keyName)}=${encodeURIComponent(keyValue)}`;
          break;
        }
        case 'none':
          break;
        default:
          throw new McpError(
            ErrorCode.InvalidParams,
            `Unknown AUTH_TYPE "${authType}" for service [${service}]`
          );
      }

      const requestHeaders = { ...authHeaders };

      if (config.DEFAULT_HEADERS) {
        try {
          const defaults = JSON.parse(config.DEFAULT_HEADERS);
          Object.assign(requestHeaders, defaults);
        } catch {
          console.error(`[glitch-connector] Failed to parse DEFAULT_HEADERS for [${service}]`);
        }
      }

      Object.assign(requestHeaders, headers);

      const fetchOptions = {
        method,
        headers: requestHeaders,
        redirect: 'manual'
      };

      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        fetchOptions.body = JSON.stringify(body);
        if (!requestHeaders['Content-Type']) {
          fetchOptions.headers['Content-Type'] = 'application/json';
        }
      }

      const redactedUrl = url.includes('?')
        ? url.split('?')[0] + '?***'
        : url;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      fetchOptions.signal = controller.signal;

      let response;
      try {
        response = await fetch(url, fetchOptions);
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new McpError(
            ErrorCode.InternalError,
            `Request to ${redactedUrl} timed out after 30s`
          );
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Request to ${redactedUrl} failed: ${err.message}`
        );
      }
      clearTimeout(timeoutId);

      let responseBody;
      const contentType = response.headers.get('content-type') || '';

      try {
        if (contentType.includes('application/json')) {
          responseBody = await response.json();
        } else {
          const text = await response.text();
          try {
            responseBody = JSON.parse(text);
          } catch {
            responseBody = text;
        }
        }
      } catch {
        responseBody = '[Non-parseable response body]';
      }

      const result = {
        status: response.status,
        ok: response.ok,
        body: responseBody
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    }
  }
];
