import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { createService } from './bootstrap.js';
import { configureProxy } from './providers/http.js';

const args = parseArgs({
  options: {
    max: { type: 'string', default: '100' },
    query: { type: 'string', default: '' },
    simulate: { type: 'boolean', default: false },
    scheduled: { type: 'boolean', default: false },
  },
});
const config = loadConfig();
configureProxy();
if (args.values.scheduled && (config.STORAGE_DRIVER !== 'supabase' || config.APP_MODE !== 'live')) {
  console.error(
    'Execução agendada exige APP_MODE=live e STORAGE_DRIVER=supabase para preservar limites e histórico.',
  );
  process.exitCode = 1;
} else {
  const service = createService(config);
  try {
    const campaign = await service.create({
      maxResults: Number(args.values.max),
      query: args.values.query,
    });
    const result = args.values.simulate ? await service.simulate(campaign.id) : null;
    console.log(
      JSON.stringify({
        campaignId: campaign.id,
        discovered: campaign.leads.length,
        qualified: campaign.leads.filter((l) => l.assessment.eligible).length,
        simulated: result?.simulated ?? 0,
        sent: 0,
        deliveryMode: 'dry-run',
      }),
    );
  } catch (error) {
    await service.recordError(error);
    console.error(
      error instanceof Error && error.name === 'AppError'
        ? error.message
        : 'Falha na automação. Consulte o dashboard e a configuração.',
    );
    process.exitCode = 1;
  }
}
