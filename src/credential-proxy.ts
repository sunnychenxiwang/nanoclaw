/**
 * Native credential proxy for NanoClaw.
 * Proxies Anthropic API requests and injects credentials from .env.
 * Replaces the OneCLI gateway for simple .env-based credential management.
 */
import http from 'http';
import https from 'https';
import os from 'os';
import { URL } from 'url';

import { logger } from './logger.js';
import { readEnvFile } from './env.js';

// Read credentials from .env at startup (falls back to process.env)
const envCredentials = readEnvFile([
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
]);

export interface CredentialProxyConfig {
  port: number;
  host: string;
}

// Resolve proxy bind address based on platform
// macOS/Windows: host.docker.internal resolves automatically
// Linux: bind to docker0 bridge IP or fall back to 0.0.0.0
function resolveProxyHost(): string {
  const platform = os.platform();
  if (platform === 'darwin' || platform === 'win32') {
    return '127.0.0.1'; // host.docker.internal works automatically
  }
  // Linux: try docker0 bridge first, then 0.0.0.0
  // Containers can reach via host.docker.internal (added by --add-host)
  return '0.0.0.0';
}

/**
 * Detect the auth mode from available credentials.
 * Returns 'oauth' for CLAUDE_CODE_OAUTH_TOKEN, 'api_key' for ANTHROPIC_API_KEY,
 * or null if no credentials are configured.
 */
export function detectAuthMode(): 'oauth' | 'api_key' | null {
  if (
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    envCredentials.CLAUDE_CODE_OAUTH_TOKEN
  ) {
    return 'oauth';
  }
  if (process.env.ANTHROPIC_API_KEY || envCredentials.ANTHROPIC_API_KEY) {
    return 'api_key';
  }
  // Fallback to legacy token name
  if (process.env.ANTHROPIC_AUTH_TOKEN || envCredentials.ANTHROPIC_AUTH_TOKEN) {
    return 'oauth';
  }
  return null;
}

/**
 * Get the credential value to inject.
 */
export function getCredential(): string | null {
  return (
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    envCredentials.CLAUDE_CODE_OAUTH_TOKEN ||
    process.env.ANTHROPIC_API_KEY ||
    envCredentials.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    envCredentials.ANTHROPIC_AUTH_TOKEN ||
    null
  );
}

/**
 * Get the API base URL (for custom endpoints).
 */
export function getApiBaseUrl(): string {
  return (
    process.env.ANTHROPIC_BASE_URL ||
    envCredentials.ANTHROPIC_BASE_URL ||
    'https://api.anthropic.com'
  );
}

/**
 * Create the HTTP proxy server.
 */
export function createProxyServer(): http.Server {
  const upstreamBaseUrl = getApiBaseUrl();
  const upstreamUrl = new URL(upstreamBaseUrl);

  return http.createServer((req, res) => {
    const credential = getCredential();
    const authMode = detectAuthMode();

    if (!credential || !authMode) {
      logger.error('Credential proxy: no credentials configured');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            type: 'configuration_error',
            message:
              'No Anthropic credentials found. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in .env',
          },
        }),
      );
      return;
    }

    // Read request body
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);

      // Build upstream request options
      // Combine base URL path with request path (e.g., /anthropic + /v1/messages)
      const basePath = upstreamUrl.pathname.replace(/\/$/, '');
      const requestPath = req.url || '/';
      const upstreamPath = basePath + requestPath;
      const headers: Record<string, string> = {
        ...(Object.fromEntries(
          Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
        ) as Record<string, string>),
        host: upstreamUrl.hostname,
      };

      // Inject credential header (remove any existing auth headers first)
      delete headers['authorization'];
      delete headers['x-api-key'];
      if (authMode === 'oauth') {
        headers['authorization'] = `Bearer ${credential}`;
      } else {
        headers['x-api-key'] = credential;
      }

      const upstreamOptions: https.RequestOptions = {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port || 443,
        path: upstreamPath,
        method: req.method || 'GET',
        headers,
      };

      // Make upstream request
      const upstreamReq = https.request(upstreamOptions, (upstreamRes) => {
        // Forward response headers
        res.writeHead(upstreamRes.statusCode || 500, upstreamRes.headers);
        upstreamRes.pipe(res);
      });

      upstreamReq.on('error', (err) => {
        logger.error(
          { err, path: upstreamPath },
          'Credential proxy upstream error',
        );
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              type: 'proxy_error',
              message: `Failed to reach Anthropic API: ${err.message}`,
            },
          }),
        );
      });

      // Forward request body
      if (body.length > 0) {
        upstreamReq.write(body);
      }
      upstreamReq.end();
    });

    req.on('error', (err) => {
      logger.error({ err }, 'Credential proxy request error');
      res.writeHead(400);
      res.end('Bad Request');
    });
  });
}

/**
 * Start the credential proxy server.
 * Returns the server instance and the actual port (useful if port was 0).
 */
export function startCredentialProxy(
  config?: Partial<CredentialProxyConfig>,
): Promise<{
  server: http.Server;
  port: number;
  host: string;
}> {
  const host = config?.host ?? resolveProxyHost();
  const port = config?.port ?? 3001;

  const server = createProxyServer();

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }

      const actualPort = address.port;
      const authMode = detectAuthMode();
      const credType = authMode === 'oauth' ? 'OAuth token' : 'API key';

      logger.info(
        { port: actualPort, host, authMode: credType },
        'Credential proxy started',
      );

      console.log(
        `\n  Credential proxy running on http://${host}:${actualPort}`,
      );
      console.log(`  Auth mode: ${credType}\n`);

      resolve({ server, port: actualPort, host });
    });

    server.on('error', (err) => {
      logger.error({ err, port, host }, 'Credential proxy failed to start');
      reject(err);
    });
  });
}

let proxyInstance: { server: http.Server; port: number; host: string } | null =
  null;

/**
 * Get the running proxy instance, if any.
 */
export function getProxyInstance(): typeof proxyInstance {
  return proxyInstance;
}

/**
 * Initialize and start the credential proxy.
 * Stores the instance for later access.
 */
export async function initCredentialProxy(
  config?: Partial<CredentialProxyConfig>,
): Promise<{ port: number; host: string }> {
  if (proxyInstance) {
    logger.warn('Credential proxy already running');
    return { port: proxyInstance.port, host: proxyInstance.host };
  }

  proxyInstance = await startCredentialProxy(config);
  return { port: proxyInstance.port, host: proxyInstance.host };
}
