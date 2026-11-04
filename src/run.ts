import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { createModules, createService } from './bootstrap.js';
import { configureProxy } from './providers/http.js';

try {
  const args = parseArgs({
    options: {
      scheduled: { type: 'boolean', default: false },
      simulate: { type: 'boolean', default: false },
    },
  });
  const config = loadConfig();
  configureProxy();
  if (args.values.scheduled && (config.STORAGE_DRIVER !== 'supabase' || config.APP_MODE !== 'live'))
    throw new Error('scheduled_configuration');
  const service = createService(config);
  const modules = createModules(config, service);
  const run = await modules.automation.run(args.values.scheduled, args.values.simulate);
  if (run.status === 'failed') process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      event: 'automation.failed',
      message:
        error instanceof Error && error.name === 'AppError'
          ? error.message
          : 'Falha ao executar. Para cron use APP_MODE=live e STORAGE_DRIVER=supabase; confira a configuração.',
    }),
  );
  process.exitCode = 1;
}
