import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import type { Repository } from '../domain/models.js';
import type { Run } from '../domain/operations.js';
import { dayKey } from '../domain/time.js';
import { unsubscribeToken } from '../domain/unsubscribe.js';
import type { MailTransport } from '../providers/gmail.js';
import type { DeliveryService } from './delivery.js';
import { reportText } from './reports.js';
import { AppError } from '../domain/errors.js';

export async function notifyReport(
  config: Config,
  repo: Repository,
  dispatcher: DeliveryService,
  transport: () => Promise<MailTransport>,
  run: Run,
): Promise<void> {
  if (config.DELIVERY_MODE !== 'live' || config.ENABLE_LIVE_SENDS !== 'true') return;
  if ((await dispatcher.readiness()).length) return;
  const settings = await dispatcher.settings();
  if (!settings.reportEmail || settings.reportEmail !== settings.business?.email) return;
  await repo.withLock(async () => {
    if (await repo.getRecord('report-mails', run.id)) return;
    const reports = (await repo.listRecords('report-mails')) as Array<{ at: string }>;
    const used =
      (await repo.deliveries()).filter((d) => dayKey(new Date(d.createdAt)) === run.day).length +
      reports.filter((r) => dayKey(new Date(r.at)) === run.day).length;
    if (used >= (await repo.getRules()).dailyContactLimit) return;
    if ((await repo.suppressions()).some((s) => s.email === settings.reportEmail)) return;
    const mail = await transport();
    if (
      (await mail.profile()).email !== settings.reportEmail ||
      (await dispatcher.readiness()).length
    )
      return;
    const id = randomUUID(),
      at = new Date().toISOString();
    const record = { at, status: 'reserved', gmailMessageId: null as string | null };
    await repo.putRecord('report-mails', run.id, record);
    const unsubscribeUrl = `${config.PUBLIC_ORIGIN}/unsubscribe?token=${unsubscribeToken(settings.reportEmail!, config.UNSUBSCRIBE_SIGNING_KEY!)}`;
    try {
      const result = await mail.send(
        settings.reportEmail!,
        {
          subject: `Resumo de prospecção · ${run.day}`,
          body: `${reportText(run)}\n\n${settings.business!.name}\n${settings.business!.postalAddress}\nStop summaries: ${unsubscribeUrl}`,
        },
        {
          from: settings.business!.email,
          name: settings.business!.name,
          messageId: `${id}@${settings.business!.email.split('@')[1]}`,
          unsubscribeUrl,
        },
      );
      record.status = 'sent';
      record.gmailMessageId = result.id;
      await repo.putRecord('report-mails', run.id, record);
    } catch {
      record.status = 'unknown';
      await repo.putRecord('report-mails', run.id, record);
      settings.breaker = 'Falha ao enviar resumo. Reconcilie antes de reativar.';
      settings.authorizedAt = null;
      await repo.putRecord('operations', 'default', settings);
      throw new AppError(
        502,
        'Resultado do resumo por e-mail incerto. Nenhum reenvio automático será realizado.',
      );
    }
  });
}
