import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import { contactEmailSchema, type Message } from '../domain/models.js';
import { requestJson, type Fetch } from './http.js';

export function mimeMessage(to: string, message: Message): string {
  const email = contactEmailSchema.parse(to);
  if (/[\r\n]/.test(message.subject)) throw new AppError(400, 'Assunto inválido.');
  return [
    `To: ${email}`, `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(message.body).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '',
  ].join('\r\n');
}
export interface GmailCredentials { clientId: string; clientSecret: string; refreshToken: string }
// Não existe método send nesta versão. O app web nem a rotina diária chamam createDraft.
export class GmailClient {
  constructor(private readonly credentials: GmailCredentials, private readonly fetcher: Fetch = fetch) {}
  private async accessToken(): Promise<string> {
    const result = z.object({ access_token: z.string().min(1) }).safeParse(await requestJson(this.fetcher, 'https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.credentials.clientId, client_secret: this.credentials.clientSecret, refresh_token: this.credentials.refreshToken, grant_type: 'refresh_token' }),
    }, 'OAuth do Gmail'));
    if (!result.success) throw new AppError(502, 'Resposta OAuth do Gmail inválida.');
    return result.data.access_token;
  }
  async createDraft(to: string, message: Message): Promise<string> {
    const raw = Buffer.from(mimeMessage(to, message)).toString('base64url');
    const token = await this.accessToken();
    const result = z.object({ id: z.string() }).safeParse(await requestJson(this.fetcher, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { raw } }),
    }, 'Gmail'));
    if (!result.success) throw new AppError(502, 'Resposta de rascunho do Gmail inválida.');
    return result.data.id;
  }
  async findReplies(email: string): Promise<Array<{ id: string; threadId: string }>> {
    const contact = contactEmailSchema.parse(email);
    const token = await this.accessToken();
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.search = new URLSearchParams({ q: `in:inbox from:(${contact}) newer_than:30d`, maxResults: '100' }).toString();
    const result = z.object({ messages: z.array(z.object({ id: z.string(), threadId: z.string() })).optional() }).safeParse(await requestJson(this.fetcher, url, { headers: { Authorization: `Bearer ${token}` } }, 'Gmail'));
    if (!result.success) throw new AppError(502, 'Resposta de consulta do Gmail inválida.');
    return result.data.messages ?? [];
  }
}
