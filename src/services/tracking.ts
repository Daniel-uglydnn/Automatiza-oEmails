import type { Repository } from '../domain/models.js';
import type { MailTransport } from '../providers/gmail.js';
import { AppError } from '../domain/errors.js';

export class ReplyTracking {
  constructor(
    private readonly repository: Repository,
    private readonly transport: () => Promise<MailTransport>,
  ) {}
  async sync(deadline = Date.now() + 120000): Promise<number> {
    const entries = (await this.repository.deliveries()).filter(
      (d) => d.status === 'sent' && d.gmailThreadId && d.recipient,
    );
    if (!entries.length || Date.now() >= deadline) return 0;
    const mail = await this.transport();
    let count = 0;
    for (const entry of entries.slice(-100)) {
      if (Date.now() >= deadline) break;
      const messages = await mail.thread(entry.gmailThreadId!);
      for (const message of messages) {
        const sender = message.from.match(/<([^>]+)>/)?.[1] ?? message.from.trim();
        if (
          sender.toLowerCase() !== entry.recipient ||
          Date.parse(message.at) < Date.parse(entry.createdAt) ||
          message.id === entry.gmailMessageId
        )
          continue;
        const kind =
          /\b(unsubscribe|remove me|stop (?:emailing|contacting)|do not contact)\b/i.test(
            message.text,
          )
            ? 'unsubscribe'
            : /\b(not interested|no thanks|no thank you)\b/i.test(message.text)
              ? 'negative'
              : 'received';
        if (kind !== 'received') await this.repository.suppress(entry.recipient!, kind);
        await this.repository.withLock(async () => {
          const current = (await this.repository.deliveries()).find((d) => d.id === entry.id)!;
          if (current.replies.some((r) => r.id === message.id)) return;
          current.replies.push({
            detectedAt: new Date().toISOString(),
            id: message.id,
            at: message.at,
            kind,
            note:
              kind === 'received'
                ? 'Resposta detectada no mesmo thread; classificação humana pendente.'
                : 'Bloqueio conservador por solicitação explícita no snippet da resposta.',
          });
          if (['new', 'replied'].includes(current.crmStage) || kind !== 'received')
            current.crmStage = kind === 'received' ? 'replied' : kind;
          current.crmUpdatedAt = message.at;
          await this.repository.saveDelivery(current);
          count++;
        });
      }
    }
    return count;
  }
  async stage(
    id: string,
    stage: 'positive' | 'negotiation' | 'won' | 'negative' | 'unsubscribe',
  ): Promise<void> {
    await this.repository.withLock(async () => {
      const current = (await this.repository.deliveries()).find((d) => d.id === id);
      if (!current) throw new AppError(404, 'Contato enviado não encontrado.');
      if (['negative', 'unsubscribe'].includes(stage) && current.recipient)
        await this.repository.suppress(current.recipient, stage as 'negative' | 'unsubscribe');
      current.crmStage = stage;
      current.crmUpdatedAt = new Date().toISOString();
      await this.repository.saveDelivery(current);
    });
  }
}
