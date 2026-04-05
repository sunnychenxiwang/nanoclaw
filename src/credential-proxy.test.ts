import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';

import {
  detectAuthMode,
  getCredential,
  getApiBaseUrl,
  createProxyServer,
} from './credential-proxy.js';

describe('credential-proxy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear credential-related env vars
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe('detectAuthMode', () => {
    it('returns null when no credentials are set', () => {
      expect(detectAuthMode()).toBeNull();
    });

    it('returns oauth for CLAUDE_CODE_OAUTH_TOKEN', () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
      expect(detectAuthMode()).toBe('oauth');
    });

    it('returns api_key for ANTHROPIC_API_KEY', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      expect(detectAuthMode()).toBe('api_key');
    });

    it('prefers OAuth token over API key', () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      expect(detectAuthMode()).toBe('oauth');
    });

    it('supports legacy ANTHROPIC_AUTH_TOKEN', () => {
      process.env.ANTHROPIC_AUTH_TOKEN = 'legacy-token';
      expect(detectAuthMode()).toBe('oauth');
    });
  });

  describe('getCredential', () => {
    it('returns null when no credentials are set', () => {
      expect(getCredential()).toBeNull();
    });

    it('returns CLAUDE_CODE_OAUTH_TOKEN when set', () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-oauth-token';
      expect(getCredential()).toBe('test-oauth-token');
    });

    it('returns ANTHROPIC_API_KEY when set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-apikey';
      expect(getCredential()).toBe('sk-ant-apikey');
    });

    it('prefers OAuth token over API key', () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-token';
      process.env.ANTHROPIC_API_KEY = 'api-key';
      expect(getCredential()).toBe('oauth-token');
    });
  });

  describe('getApiBaseUrl', () => {
    it('returns default Anthropic API URL', () => {
      expect(getApiBaseUrl()).toBe('https://api.anthropic.com');
    });

    it('returns custom base URL when set', () => {
      process.env.ANTHROPIC_BASE_URL = 'https://custom.api.com';
      expect(getApiBaseUrl()).toBe('https://custom.api.com');
    });
  });

  describe('createProxyServer', () => {
    it('creates an HTTP server', () => {
      const server = createProxyServer();
      expect(server).toBeInstanceOf(http.Server);
      server.close();
    });

    it('returns 500 when no credentials are configured', async () => {
      const server = createProxyServer();

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address() as { port: number };
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port: address.port,
              method: 'POST',
              path: '/v1/messages',
            },
            (res) => {
              expect(res.statusCode).toBe(500);
              let body = '';
              res.on('data', (chunk) => (body += chunk));
              res.on('end', () => {
                const data = JSON.parse(body);
                expect(data.error.type).toBe('configuration_error');
                server.close();
                resolve();
              });
            },
          );
          req.end();
        });
      });
    });
  });
});
