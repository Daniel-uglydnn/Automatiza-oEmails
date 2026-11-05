import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Config } from './config.js';
import { AppError } from './domain/errors.js';
import { verifyUnsubscribeToken } from './domain/unsubscribe.js';
import type { ProspectingService } from './services/prospecting.js';
import { createModules } from './bootstrap.js';
import { campaignsCSV, reportText } from './services/reports.js';
import { runSchema } from './domain/operations.js';
import type { Fetch } from './providers/http.js';

const leadParams = z.object({ id: z.uuid(), channelId: z.string().min(1).max(100) });
export async function buildApp(
  config: Config,
  service: ProspectingService,
  webRoot = resolve('dist/web'),
  dependencies: { publicFetch?: Fetch } = {},
) {
  const modules = createModules(config, service, dependencies.publicFetch);
  const app = Fastify({ logger: false, bodyLimit: 32768, requestTimeout: 420000 });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const host = request.headers.host ?? '';
    let origin: URL;
    try {
      origin = new URL(`http://${host}`);
    } catch {
      throw new AppError(400, 'Host inválido.');
    }
    const configuredHost = config.PUBLIC_ORIGIN ? new URL(config.PUBLIC_ORIGIN).host : null;
    if (
      configuredHost
        ? host !== configuredHost
        : !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
    )
      throw new AppError(
        403,
        'Host não autorizado. Configure PUBLIC_ORIGIN para hospedagem externa.',
      );
    const isUnsubscribe = request.url.split('?')[0] === '/unsubscribe';
    if (!isUnsubscribe && request.headers.origin) {
      const expected = config.PUBLIC_ORIGIN ?? origin.origin;
      if (request.headers.origin !== expected) throw new AppError(403, 'Origem não autorizada.');
    }
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      if (config.API_AUTH_TOKEN) {
        const expected = createHash('sha256').update(`Bearer ${config.API_AUTH_TOKEN}`).digest();
        const actual = createHash('sha256')
          .update(request.headers.authorization ?? '')
          .digest();
        if (!timingSafeEqual(expected, actual))
          throw new AppError(401, 'Informe o token de acesso do dashboard.');
      }
    }
  });
  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: 'Dados inválidos.',
        details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    if (error instanceof AppError) {
      if (error.statusCode >= 500) await service.recordError(error);
      return reply.code(error.statusCode).send({ error: error.message });
    }
    const status =
      typeof error === 'object' &&
      error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (status >= 500) await service.recordError(error);
    return reply.code(status >= 400 && status < 500 ? status : 500).send({
      error:
        status === 429
          ? 'Muitas solicitações. Aguarde um minuto.'
          : status < 500
            ? 'Requisição inválida.'
            : 'Falha interna. Verifique configuração e armazenamento.',
    });
  });
  app.get('/health', async () => ({ status: 'ok', deliveryMode: config.DELIVERY_MODE }));
  app.get('/api/dashboard', async () => ({
    ...(await service.dashboard()),
    deliveryMode: config.DELIVERY_MODE,
    sendingEnabled: (await modules.delivery.readiness()).length === 0,
  }));
  app.get('/api/operations', async () => ({
    settings: await modules.operations.get(),
    gmail: await modules.gmail.status(),
    liveBlockReasons: await modules.delivery.readiness(),
    deliveries: await service.repository.deliveries(),
  }));
  app.put('/api/operations', (request) => modules.operations.update(request.body));
  app.post(
    '/api/operations/unsubscribe-test',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    () => modules.operations.testUnsubscribe(),
  );
  app.post('/api/operations/authorize', (request) => modules.operations.authorize(request.body));
  app.post('/api/operations/revoke', async () => {
    await modules.operations.revoke();
    return { revoked: true };
  });
  app.post('/api/gmail/connect', async () => ({ url: await modules.gmail.start() }));
  app.post('/api/gmail/validate', async () => {
    await modules.gmail.validateEnvironment();
    return modules.gmail.status();
  });
  app.get('/oauth/gmail/callback', async (request, reply) => {
    const { code, state } = z
      .object({ code: z.string().min(1).max(4000), state: z.string().min(20).max(200) })
      .parse(request.query);
    await modules.gmail.callback(code, state);
    return reply
      .header('Cache-Control', 'no-store')
      .type('text/html')
      .send(
        '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Gmail conectado</title><h1>Gmail conectado</h1><p>A conta foi autorizada. Nenhum e-mail foi enviado. A ativação comercial é uma etapa separada.</p><a href="/">Voltar ao dashboard</a></html>',
      );
  });
  app.post(
    '/api/automation/run',
    { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } },
    (request) => {
      const body = z
        .object({ simulate: z.boolean().default(true) })
        .strict()
        .parse(request.body ?? {});
      return modules.automation.run(false, body.simulate);
    },
  );
  app.post('/api/tracking/sync', async () => ({ detected: await modules.tracking.sync() }));
  app.post('/api/deliveries/reconcile', async () => ({
    reconciled: await modules.delivery.reconcile(),
  }));
  app.put('/api/deliveries/:id/stage', async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { stage } = z
      .object({ stage: z.enum(['positive', 'negotiation', 'won', 'negative', 'unsubscribe']) })
      .strict()
      .parse(request.body);
    await modules.tracking.stage(id, stage);
    return { updated: true };
  });
  app.get('/api/reports', async () =>
    z
      .array(runSchema)
      .parse(await service.repository.listRecords('runs'))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  );
  app.get('/api/reports/:id', async (request, reply) => {
    const { id } = z
      .object({
        id: z
          .string()
          .regex(/^[a-zA-Z0-9:_-]+$/)
          .max(100),
      })
      .parse(request.params);
    const value = await service.repository.getRecord('runs', id);
    if (!value) throw new AppError(404, 'Relatório não encontrado.');
    return reply.type('text/plain; charset=utf-8').send(reportText(runSchema.parse(value)));
  });
  app.get('/api/export.csv', async (_request, reply) =>
    reply
      .header('Content-Disposition', 'attachment; filename="prospeccao.csv"')
      .type('text/csv; charset=utf-8')
      .send(campaignsCSV(await service.repository.list(), await service.repository.deliveries())),
  );
  app.get('/api/integrations', async () => ({
    youtube: { configured: !!config.YOUTUBE_API_KEY, active: config.APP_MODE === 'live' },
    openai: { configured: !!(config.LLM_API_KEY || config.OPENAI_API_KEY) },
    gmail: {
      configured: !!(
        config.GMAIL_CLIENT_ID &&
        config.GMAIL_CLIENT_SECRET &&
        (config.GMAIL_REFRESH_TOKEN || (await modules.gmail.account()))
      ),
      sendingEnabled: (await modules.delivery.readiness()).length === 0,
    },
    supabase: {
      configured: !!(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY),
      active: config.STORAGE_DRIVER === 'supabase',
    },
    unsubscribe: { configured: !!(config.PUBLIC_ORIGIN && config.UNSUBSCRIBE_SIGNING_KEY) },
    note: 'Presença de configuração não significa credenciais validadas. Nenhum envio real está habilitado.',
  }));
  app.post(
    '/api/campaigns',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => reply.code(201).send(await service.create(request.body ?? {})),
  );
  app.get('/api/campaigns/:id', (request) =>
    service.get(z.object({ id: z.uuid() }).parse(request.params).id),
  );
  app.post('/api/campaigns/:id/simulate', (request) =>
    service.simulate(z.object({ id: z.uuid() }).parse(request.params).id),
  );
  app.put('/api/campaigns/:id/leads/:channelId/review', (request) => {
    const p = leadParams.parse(request.params);
    return service.review(p.id, p.channelId, request.body);
  });
  app.put('/api/campaigns/:id/leads/:channelId/contact', (request) => {
    const p = leadParams.parse(request.params);
    return service.contact(p.id, p.channelId, request.body);
  });
  app.post('/api/campaigns/:id/leads/:channelId/draft', (request) => {
    const p = leadParams.parse(request.params);
    return service.draft(p.id, p.channelId, request.body ?? {});
  });
  app.post('/api/campaigns/:id/leads/:channelId/response', (request) => {
    const p = leadParams.parse(request.params);
    return service.response(p.id, p.channelId, request.body);
  });
  app.put('/api/rules', async (request) => {
    const body = z
      .object({ rules: z.unknown(), complianceReviewed: z.boolean().default(false) })
      .strict()
      .parse(request.body);
    return service.updateRules(body.rules, body.complianceReviewed);
  });
  app.post('/api/suppressions', async (request, reply) => {
    await service.suppress(z.object({ email: z.string() }).strict().parse(request.body).email);
    return reply.code(201).send({ blocked: true });
  });
  const unsubscribeEmail = (query: unknown) => {
    if (!config.UNSUBSCRIBE_SIGNING_KEY)
      throw new AppError(503, 'Descadastro público ainda não configurado.');
    return verifyUnsubscribeToken(
      z.object({ token: z.string().max(600) }).parse(query).token,
      config.UNSUBSCRIBE_SIGNING_KEY,
    );
  };
  app.get('/unsubscribe', async (request, reply) => {
    const email = unsubscribeEmail(request.query);
    const testNotice =
      email.startsWith('unsubscribe-self-test-') && email.endsWith('@example.invalid')
        ? '<p>Teste com endereço fictício. Nenhum e-mail será enviado.</p>'
        : '';
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Unsubscribe-Handler', 'creator-outreach-v1');
    return reply
      .type('text/html')
      .send(
        `<!doctype html><html lang="en"><meta charset="UTF-8"><title>Unsubscribe</title><h1>Stop commercial contact</h1>${testNotice}<p>Confirm to block this business address from future outreach.</p><form method="post"><button type="submit">Unsubscribe</button></form></html>`,
      );
  });
  app.post('/unsubscribe', async (request, reply) => {
    await service.suppress(unsubscribeEmail(request.query), 'unsubscribe');
    return reply
      .header('Cache-Control', 'no-store')
      .type('text/plain')
      .send('Unsubscribed. This address is blocked from future outreach.');
  });
  await app.register(staticFiles, { root: webRoot, index: ['index.html'] });
  return app;
}
