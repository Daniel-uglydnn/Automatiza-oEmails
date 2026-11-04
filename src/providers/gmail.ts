import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import { contactEmailSchema, type Message } from '../domain/models.js';
import { requestJson, type Fetch } from './http.js';

export interface Envelope {
  from: string;
  name: string;
  unsubscribeUrl: string;
  messageId: string;
}
export function mimeMessage(to: string, message: Message, envelope?: Envelope): string {
  const email = contactEmailSchema.parse(to);
  if (/[\r\n]/.test(message.subject)) throw new AppError(400, 'Assunto inválido.');
  const headers = [
    `To: ${email}`,
    `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`,
  ];
  if (envelope) {
    const from = contactEmailSchema.parse(envelope.from);
    const url = new URL(envelope.unsubscribeUrl);
    if (
      url.protocol !== 'https:' ||
      /[\r\n<>]/.test(envelope.messageId) ||
      !/^[A-Za-z0-9@._-]+$/.test(envelope.messageId)
    )
      throw new AppError(400, 'Envelope inválido.');
    headers.push(
      `From: =?UTF-8?B?${Buffer.from(envelope.name).toString('base64')}?= <${from}>`,
      `Reply-To: ${from}`,
      `Message-ID: <${envelope.messageId}>`,
      `List-Unsubscribe: <${url.href}>`,
      'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    );
  }
  return [
    ...headers,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(message.body)
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\r\n') ?? '',
  ].join('\r\n');
}
export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}
export interface ReplyMessage {
  id: string;
  threadId: string;
  from: string;
  at: string;
  text: string;
  references: string;
}
export interface MailTransport {
  profile(): Promise<{ email: string; scopes: string[] }>;
  send(to: string, message: Message, envelope: Envelope): Promise<{ id: string; threadId: string }>;
  thread(id: string): Promise<ReplyMessage[]>;
  findSent(messageId: string): Promise<Array<{ id: string; threadId: string }>>;
}
export class GmailClient implements MailTransport {
  private token: string | null = null;
  private expires = 0;
  private scopes: string[];
  constructor(
    private readonly credentials: GmailCredentials,
    private readonly fetcher: Fetch = fetch,
    scopes: string[] = [],
  ) {
    this.scopes = scopes;
  }
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.expires) return this.token;
    const result = z
      .object({
        access_token: z.string().min(1),
        expires_in: z.number().optional(),
        scope: z.string().optional(),
      })
      .safeParse(
        await requestJson(
          this.fetcher,
          'https://oauth2.googleapis.com/token',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: this.credentials.clientId,
              client_secret: this.credentials.clientSecret,
              refresh_token: this.credentials.refreshToken,
              grant_type: 'refresh_token',
            }),
          },
          'OAuth do Gmail',
        ),
      );
    if (!result.success) throw new AppError(502, 'Resposta OAuth do Gmail inválida.');
    this.token = result.data.access_token;
    this.expires = Date.now() + Math.max(0, (result.data.expires_in ?? 300) - 60) * 1000;
    if (result.data.scope) this.scopes = result.data.scope.split(' ');
    return this.token;
  }
  private async api(path: string, options: RequestInit = {}) {
    const token = await this.accessToken();
    return requestJson(
      this.fetcher,
      `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      },
      'Gmail',
    );
  }
  async profile() {
    const result = z.object({ emailAddress: contactEmailSchema }).parse(await this.api('profile'));
    return { email: result.emailAddress, scopes: [...this.scopes] };
  }
  async createDraft(to: string, message: Message): Promise<string> {
    const result = z.object({ id: z.string() }).parse(
      await this.api('drafts', {
        method: 'POST',
        body: JSON.stringify({
          message: { raw: Buffer.from(mimeMessage(to, message)).toString('base64url') },
        }),
      }),
    );
    return result.id;
  }
  async send(to: string, message: Message, envelope: Envelope) {
    // POST é deliberadamente sem retry. O dispatcher persiste reserva antes desta chamada.
    return z.object({ id: z.string(), threadId: z.string() }).parse(
      await this.api('messages/send', {
        method: 'POST',
        body: JSON.stringify({
          raw: Buffer.from(mimeMessage(to, message, envelope)).toString('base64url'),
        }),
      }),
    );
  }
  private async messages(query: string): Promise<Array<{ id: string; threadId: string }>> {
    const messages: Array<{ id: string; threadId: string }> = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({
        q: query,
        maxResults: '100',
        ...(pageToken ? { pageToken } : {}),
      });
      const result = z
        .object({
          messages: z.array(z.object({ id: z.string(), threadId: z.string() })).default([]),
          nextPageToken: z.string().optional(),
        })
        .parse(await this.api(`messages?${params}`));
      messages.push(...result.messages);
      if (!result.nextPageToken || result.nextPageToken === pageToken) break;
      pageToken = result.nextPageToken;
    }
    return messages;
  }
  async findReplies(email: string) {
    return this.messages(`in:inbox from:(${contactEmailSchema.parse(email)}) newer_than:30d`);
  }
  async findSent(messageId: string) {
    return this.messages(`in:sent rfc822msgid:${messageId.replace(/[^A-Za-z0-9@._-]/g, '')}`);
  }
  async thread(id: string): Promise<ReplyMessage[]> {
    const result = z
      .object({
        messages: z
          .array(
            z.object({
              id: z.string(),
              threadId: z.string(),
              internalDate: z.string(),
              snippet: z.string().default(''),
              payload: z
                .object({
                  headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
                })
                .optional(),
            }),
          )
          .default([]),
      })
      .parse(await this.api(`threads/${encodeURIComponent(id)}?format=metadata`));
    return result.messages.map((message) => {
      const header = (name: string) =>
        message.payload?.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
        '';
      return {
        id: message.id,
        threadId: message.threadId,
        from: header('From'),
        at: new Date(Number(message.internalDate)).toISOString(),
        text: message.snippet,
        references: `${header('In-Reply-To')} ${header('References')}`,
      };
    });
  }
}
