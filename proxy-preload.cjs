/**
 * Preload script to configure proxy before any modules load.
 * This runs in CommonJS context and modifies the require.cache.
 */
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
if (proxyUrl) {
  console.log(`[Proxy Preload] Configuring proxy: ${proxyUrl}`);

  try {
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const path = require('path');

    // Configure HTTP proxy
    setGlobalDispatcher(new ProxyAgent(proxyUrl));

    const proxyAgent = new HttpsProxyAgent(proxyUrl);

    // Hook into Module._load to intercept ws module loading
    const Module = require('module');
    const originalLoad = Module._load;

    Module._load = function(request, parent, isMain) {
      const result = originalLoad.apply(this, arguments);

      // Intercept ws module and wrap WebSocket
      if (request === 'ws' || (parent && parent.filename && parent.filename.includes('@discordjs/ws'))) {
        if (result && result.WebSocket && !result._proxyWrapped) {
          const OriginalWebSocket = result.WebSocket;

          const ProxiedWebSocket = function(url, protocols, options) {
            if (protocols && typeof protocols === 'object' && !Array.isArray(protocols)) {
              options = protocols;
              protocols = undefined;
            }
            return new OriginalWebSocket(url, protocols, { agent: proxyAgent, ...options });
          };

          Object.getOwnPropertyNames(OriginalWebSocket).forEach((name) => {
            if (!(name in ProxiedWebSocket)) {
              ProxiedWebSocket[name] = OriginalWebSocket[name];
            }
          });
          Object.setPrototypeOf(ProxiedWebSocket, OriginalWebSocket);

          result.WebSocket = ProxiedWebSocket;
          result._proxyWrapped = true;
          console.log('[Proxy Preload] Wrapped ws module WebSocket');
        }
      }

      return result;
    };

    console.log('[Proxy Preload] Proxy hook installed');
  } catch (err) {
    console.error('[Proxy Preload] Failed to configure proxy:', err.message);
  }
}
