import { config as dotenv } from 'dotenv';
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { HiggsfieldClient } from './higgsfield/client.js';
import { credentialSecrets } from './higgsfield/credentials.js';
import { createApp } from './app.js';

dotenv({ quiet: true });
try {
  const config = loadConfig();
  const logger = createLogger(credentialSecrets(config.HF_CREDENTIALS), config.LOG_LEVEL);
  const client = new HiggsfieldClient({ credentials: config.HF_CREDENTIALS, logger });
  const runtime = createApp(config, client, logger);
  const http = createServer(runtime.app);
  http.requestTimeout = 35_000;
  http.headersTimeout = 10_000;
  http.setTimeout(40_000, socket => socket.destroy());
  http.keepAliveTimeout = 5000;
  http.on('error', () => { logger.fatal({ event: 'server_listen_failed' }); process.exitCode = 1; });
  http.listen(config.PORT, config.HOST, () => logger.info({ event: 'server_started', host: config.HOST, port: config.PORT, auth: config.AUTH_MODE }));
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    logger.info({ event: 'server_stopping' });
    const timer = setTimeout(() => { http.closeAllConnections(); process.exit(1); }, 10_000).unref();
    http.close(() => { clearTimeout(timer); });
    void runtime.close().catch(() => { logger.error({ event: 'shutdown_failed' }); process.exitCode = 1; });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch {
  console.error('Startup failed. Check server configuration against .env.example and DEPLOYMENT.md.');
  process.exitCode = 1;
}
