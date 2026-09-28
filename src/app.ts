import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, hostHeaderValidation } from '@modelcontextprotocol/node';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import { authMiddleware, protectedResource, type createTokenVerifier } from './auth.js';
import type { HiggsfieldClient } from './higgsfield/client.js';
import { createMcpServer } from './mcp/tools.js';

export function createApp(config: Config, client: HiggsfieldClient, logger: Logger, verify?: ReturnType<typeof createTokenVerifier>) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  const validateHost = hostHeaderValidation(['localhost', '127.0.0.1', '[::1]', ...(config.PUBLIC_URL ? [new URL(config.PUBLIC_URL).hostname] : [])]);
  app.use((req, res, next) => { if (validateHost(req, res)) next(); });
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'higgsfield-mcp', version: '1.0.0', credentials_configured: Boolean(config.HF_CREDENTIALS) }));

  if (config.AUTH_MODE === 'oauth') {
    app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) => res.json(protectedResource(config)));
  }
  const origins = new Set(config.ALLOWED_ORIGINS.split(',').filter(Boolean));
  app.use('/mcp', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      let localOrigin = false;
      try { const u = new URL(origin); localOrigin = config.AUTH_MODE === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && ['http:', 'https:'].includes(u.protocol); } catch { /* reject below */ }
      if (!origins.has(origin) && !localOrigin) { res.status(403).json({ error: 'origin_not_allowed' }); return; }
      res.set('Access-Control-Allow-Origin', origin).set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID');
      res.set('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      res.set('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version, MCP-Session-Id, Retry-After');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  // A conservative per-process limiter. Keep proxy trust disabled; see deployment guide.
  app.use('/mcp', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'rate_limited' } }));
  if (config.AUTH_MODE === 'oauth') app.use('/mcp', authMiddleware(config, verify));
  const handler = createMcpHandler(() => createMcpServer(client, logger, config.AUTH_MODE === 'oauth' ? config.OAUTH_SCOPE : undefined), {
    legacy: 'stateless', maxRequestBodySize: 131_072,
    onerror: () => logger.error({ event: 'mcp_transport_error' }),
  });
  const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: 131_072, onerror: () => logger.error({ event: 'mcp_adapter_error' }) });
  app.all('/mcp', async (req, res) => {
    const started = Date.now();
    res.once('finish', () => logger.info({ event: 'mcp_http', status: res.statusCode, duration_ms: Date.now() - started }));
    await nodeHandler(req, res);
  });
  app.use((_req, res) => { res.status(404).json({ error: 'not_found' }); });
  const errorHandler: express.ErrorRequestHandler = (_error, _req, res, _next) => {
    logger.error({ event: 'http_error' });
    if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    else res.end();
  };
  app.use(errorHandler);
  return { app, close: () => handler.close() };
}
