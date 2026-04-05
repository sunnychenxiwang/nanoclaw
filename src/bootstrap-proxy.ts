/**
 * Bootstrap file to configure proxy before any other modules load.
 * This must be imported first to ensure WebSocket proxy works for Discord.
 */
import { createRequire } from 'module';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { HttpsProxyAgent } from 'https-proxy-agent';

const proxyUrl =
  process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
if (proxyUrl) {
  // Configure HTTP proxy
  setGlobalDispatcher(new ProxyAgent(proxyUrl));

  // Configure WebSocket proxy by monkey-patching the ws module
  const require = createRequire(import.meta.url);
  const wsModule = require('ws');
  const OriginalWebSocket = wsModule.WebSocket;
  const proxyAgent = new HttpsProxyAgent(proxyUrl);

  const ProxiedWebSocket = function (
    url: string | URL,
    protocols?: string | string[] | object,
    options?: object,
  ) {
    if (
      protocols &&
      typeof protocols === 'object' &&
      !Array.isArray(protocols)
    ) {
      options = protocols;
      protocols = undefined;
    }
    // @ts-ignore
    return new OriginalWebSocket(url, protocols, {
      agent: proxyAgent,
      ...options,
    });
  };

  Object.getOwnPropertyNames(OriginalWebSocket).forEach((name) => {
    if (!(name in ProxiedWebSocket)) {
      // @ts-ignore
      ProxiedWebSocket[name] = OriginalWebSocket[name];
    }
  });
  Object.setPrototypeOf(ProxiedWebSocket, OriginalWebSocket);

  Object.defineProperty(wsModule, 'WebSocket', {
    value: ProxiedWebSocket,
    writable: true,
    configurable: true,
    enumerable: true,
  });

  console.log(`[Proxy] Configured: ${proxyUrl}`);
}

export {};
