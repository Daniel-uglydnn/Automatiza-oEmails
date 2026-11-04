import { loadConfig } from './config.js';
import { createService } from './bootstrap.js';
import { buildApp } from './app.js';
import { configureProxy } from './providers/http.js';

try {
  const config = loadConfig();
  configureProxy();
  const service = createService(config);
  await service.repository.getRules();
  const app = await buildApp(config, service);
  await app.listen({ host: config.HOST, port: config.PORT });
  console.log(`Dashboard iniciado na porta ${config.PORT}. Descoberta: ${config.APP_MODE}. Envio: dry-run.`);
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch (error) {
  console.error(error instanceof Error && error.name === 'AppError' ? error.message : 'Falha ao iniciar. Verifique porta, configuração e armazenamento.');
  process.exitCode = 1;
}
