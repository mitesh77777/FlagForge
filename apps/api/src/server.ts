import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });

  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  app.log.info(
    { port: config.API_PORT, env: config.NODE_ENV },
    'FlagForge API listening (control plane /api, data plane /v1)',
  );

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, 'shutting down');
    app
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('❌ failed to start API', err);
  process.exit(1);
});