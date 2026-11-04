import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { YouTubeDiscovery, publicEmail } from '../src/providers/youtube.js';
import { defaultRules, campaignInputSchema, portfolios } from '../src/domain/models.js';
import { demoChannels } from '../src/providers/demo.js';
import {
  OpenAIWriter,
  TemplateWriter,
  validateMessage,
  wordCount,
} from '../src/providers/messages.js';
import { GmailClient, mimeMessage } from '../src/providers/gmail.js';
import { requestJson, type Fetch } from '../src/providers/http.js';
import { now } from './helpers.js';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
test('só extrai contato com contexto comercial público, sem adivinhar endereço', () => {
  assert.equal(publicEmail('Business inquiries: Work@Example.com'), 'work@example.com');
  assert.equal(publicEmail('Fan messages: fan@example.com'), null);
  assert.equal(
    publicEmail('Fan mail: fans@example.com\nBusiness inquiries: work@example.com'),
    'work@example.com',
  );
  assert.equal(publicEmail('Business inquiries:\nwork@example.com'), 'work@example.com');
  assert.equal(publicEmail('Contact me through the captcha in the about page.'), null);
});
test('YouTube busca 50/50, deduplica canais e consulta vídeos de verdade', async () => {
  const calls: URL[] = [];
  const fetcher: Fetch = async (request, init) => {
    const url = new URL(String(request));
    calls.push(url);
    assert.equal(new Headers(init?.headers).get('X-Goog-Api-Key'), 'test-key');
    assert.equal(url.searchParams.has('key'), false);
    const endpoint = url.pathname.split('/').at(-1);
    if (endpoint === 'search') {
      assert.equal(url.searchParams.get('relevanceLanguage'), 'en');
      assert.equal(url.searchParams.get('type'), 'video');
      const id = url.searchParams.get('q')?.startsWith('minecraft') ? 'mc' : 'rb';
      return json({
        items: [
          { snippet: { channelId: id } },
          { snippet: { channelId: id } },
          { snippet: { channelId: 'known' } },
        ],
      });
    }
    if (endpoint === 'channels')
      return json({
        items: ['mc', 'rb'].map((id) => ({
          id,
          snippet: { title: id, description: 'Business: editor@example.com' },
          statistics: { subscriberCount: '3000', videoCount: '5', viewCount: '50000' },
          contentDetails: { relatedPlaylists: { uploads: `uploads-${id}` } },
        })),
      });
    if (endpoint === 'playlistItems')
      return json({
        items: [
          {
            contentDetails: {
              videoId:
                url.searchParams.get('playlistId') === 'uploads-mc' ? 'mc-video' : 'rb-video',
            },
          },
        ],
      });
    if (endpoint === 'videos')
      return json({
        items: ['mc', 'rb'].map((id) => ({
          id: `${id}-video`,
          snippet: {
            channelId: id,
            title: id === 'mc' ? 'Minecraft Hardcore' : 'Roblox Challenge',
            description: '',
            publishedAt: now.toISOString(),
            defaultAudioLanguage: 'en-US',
          },
          statistics: { viewCount: '1000' },
        })),
      });
    throw new Error('Unexpected endpoint');
  };
  const channels = await new YouTubeDiscovery('test-key', fetcher, () => now).discover(
    campaignInputSchema.parse({ maxResults: 2 }),
    defaultRules,
    new Set(['known']),
  );
  assert.equal(channels.length, 2);
  assert.equal(channels[0]?.country, null);
  assert.equal(channels[0]?.videos[0]?.language, 'en-US');
  assert.equal(channels[0]?.contactSource, 'public_description');
  assert.equal(calls.filter((c) => c.pathname.endsWith('/search')).length, 2);
});
test('YouTube limita paginação e não inventa leads', async () => {
  let searches = 0;
  const fetcher: Fetch = async (request) => {
    const url = new URL(String(request));
    if (url.pathname.endsWith('/search')) {
      searches++;
      return json({ items: [], nextPageToken: String(searches) });
    }
    throw new Error('Should not query details for no channels');
  };
  const channels = await new YouTubeDiscovery('k', fetcher).discover(
    campaignInputSchema.parse({ maxResults: 100 }),
    { ...defaultRules, youtubeSearchBudget: 6 },
    new Set(),
  );
  assert.equal(searches, 6);
  assert.equal(channels.length, 0);
});
test('YouTube preserva inscritos ocultos, país declarado e views indisponíveis', async () => {
  const fetcher: Fetch = async (request) => {
    const url = new URL(String(request));
    if (url.pathname.endsWith('/search'))
      return json({ items: [{ snippet: { channelId: 'mc-hidden' } }] });
    if (url.pathname.endsWith('/channels'))
      return json({
        items: [
          {
            id: 'mc-hidden',
            snippet: { title: 'Minecraft channel', description: '', country: 'BR' },
            statistics: {
              hiddenSubscriberCount: true,
              subscriberCount: '12345',
              videoCount: '5',
              viewCount: '50000',
            },
            contentDetails: { relatedPlaylists: { uploads: 'uploads' } },
          },
        ],
      });
    if (url.pathname.endsWith('/playlistItems'))
      return json({ items: [{ contentDetails: { videoId: 'video' } }] });
    return json({
      items: [
        {
          id: 'video',
          snippet: {
            channelId: 'mc-hidden',
            title: 'Minecraft Hardcore',
            description: '',
            publishedAt: now.toISOString(),
          },
        },
      ],
    });
  };
  const channels = await new YouTubeDiscovery('k', fetcher).discover(
    campaignInputSchema.parse({ maxResults: 1 }),
    defaultRules,
    new Set(),
  );
  assert.equal(channels[0]?.subscriberCount, null);
  assert.equal(channels[0]?.country, 'BR');
  assert.equal(channels[0]?.videos[0]?.viewCount, null);
  assert.equal(channels[0]?.videos[0]?.language, null);
});
test('erros de API são sanitizados sem expor chaves ou corpo de erro', async () => {
  await assert.rejects(
    () =>
      requestJson(
        async () => json({ secret: 'do-not-leak' }, 403),
        'https://example.com',
        {},
        'YouTube',
      ),
    (error) => {
      assert.match((error as Error).message, /HTTP 403/);
      assert.doesNotMatch((error as Error).message, /do-not-leak/);
      return true;
    },
  );
  await assert.rejects(
    () =>
      new YouTubeDiscovery('k', async () => json({ malformed: true })).discover(
        campaignInputSchema.parse({}),
        defaultRules,
        new Set(),
      ),
    /Resposta inesperada/,
  );
});
test('modelo produz inglês com 80–140 palavras, ambos portfólios e convite', async () => {
  const draft = await new TemplateWriter().write(demoChannels(now)[0]!);
  assert.ok(wordCount(draft.body) >= 80 && wordCount(draft.body) <= 140);
  assert.ok(portfolios.every((p) => draft.body.includes(p)));
  assert.match(draft.body, /I'm Daniel/);
  assert.match(draft.body, /conversation/);
  assert.doesNotMatch(draft.body, /guarantee|I watched/);
});
test('título externo com promessa não faz o modelo repetir promessa ou quebrar a geração', async () => {
  const channel = demoChannels(now)[0]!;
  channel.videos[0]!.title = 'Minecraft guaranteed views and retention';
  const draft = await new TemplateWriter().write(channel);
  assert.doesNotMatch(draft.body, /guaranteed/i);
  assert.match(draft.body, /https:\/\/www.youtube.com\/watch\?v=/);
});
test('regras de mensagem rejeitam promessas, cabeçalhos injetados e ausência de portfólio', async () => {
  const draft = await new TemplateWriter().write(demoChannels(now)[0]!);
  assert.throws(() =>
    validateMessage({ subject: 'Hello\r\nBcc: victim@example.com', body: draft.body }),
  );
  assert.throws(() =>
    validateMessage({ subject: draft.subject, body: draft.body.replace(portfolios[0], '') }),
  );
  assert.throws(() =>
    validateMessage({
      subject: draft.subject,
      body: draft.body.replace('I can help', 'I guarantee'),
    }),
  );
});
test('OpenAI usa JSON estruturado e não recebe email ou credenciais do canal', async () => {
  const template = await new TemplateWriter().write(demoChannels(now)[0]!);
  const fetcher: Fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, 'json_schema');
    assert.doesNotMatch(body.input, /example.invalid/);
    return json({
      id: 'resp_test',
      object: 'response',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({ subject: template.subject, body: template.body }),
              annotations: [],
            },
          ],
        },
      ],
    });
  };
  const client = new OpenAI({ apiKey: 'fake-key', fetch: fetcher, maxRetries: 0 });
  const writer = new OpenAIWriter('fake-key', 'gpt-4.1-mini', client);
  assert.equal((await writer.write(demoChannels(now)[0]!)).source, 'openai');
});
test('Gmail prepara MIME UTF-8 e cria apenas rascunho com OAuth', async () => {
  const calls: string[] = [];
  const message = { subject: 'Edição para Minecraft', body: 'This is a draft, not a real email.' };
  const fetcher: Fetch = async (request, init) => {
    calls.push(String(request));
    if (String(request).includes('/token')) {
      assert.equal(
        new URLSearchParams(init?.body as URLSearchParams).get('grant_type'),
        'refresh_token',
      );
      return json({ access_token: 'access' });
    }
    const payload = JSON.parse(String(init?.body));
    const raw = Buffer.from(payload.message.raw, 'base64url').toString('utf8');
    assert.match(raw, /To: work@example.com\r\nSubject: =\?UTF-8\?B\?/);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    return json({ id: 'draft-1' });
  };
  const gmail = new GmailClient(
    { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
    fetcher,
  );
  assert.equal(await gmail.createDraft('work@example.com', message), 'draft-1');
  assert.ok(calls[1]?.endsWith('/drafts'));
  assert.ok(calls.every((url) => !url.endsWith('/send')));
  assert.throws(() => mimeMessage('work@example.com\r\nBcc:other@example.com', message));
});
test('Gmail consulta respostas sem alterar a caixa de entrada', async () => {
  const fetcher: Fetch = async (request, init) => {
    const url = new URL(String(request));
    if (url.pathname.endsWith('/token')) return json({ access_token: 'access' });
    assert.equal(init?.method, undefined);
    assert.match(url.searchParams.get('q')!, /in:inbox from:\(work@example.com\)/);
    return json({ messages: [{ id: 'reply-1', threadId: 'thread-1' }] });
  };
  const gmail = new GmailClient(
    { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
    fetcher,
  );
  assert.equal((await gmail.findReplies('work@example.com'))[0]?.id, 'reply-1');
});
test('POST Gmail com falha temporária não é repetido pela camada HTTP', async () => {
  let sends = 0;
  const fetcher: Fetch = async (request) => {
    if (String(request).endsWith('/token')) return json({ access_token: 'test-token' });
    sends++;
    return json({ error: 'private provider error body' }, 503);
  };
  const client = new GmailClient(
    { clientId: 'test-id', clientSecret: 'test-secret', refreshToken: 'test-refresh' },
    fetcher,
  );
  await assert.rejects(
    () =>
      client.send(
        'work@example.com',
        { subject: 'Test', body: 'Mock only' },
        {
          from: 'daniel@example.com',
          name: 'Daniel',
          unsubscribeUrl: 'https://outreach.example/unsubscribe?token=test',
          messageId: 'test-id@example.com',
        },
      ),
    /HTTP 503/,
  );
  assert.equal(sends, 1);
});
