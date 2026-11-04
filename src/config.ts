import 'dotenv/config';
import { z } from 'zod';
import { AppError } from './domain/errors.js';

const optionalValue = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const envSchema = z.object({
  APP_MODE: z.enum(['demo', 'live']).default('demo'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  DATA_DIR: z.string().min(1).default('.data'),
  API_AUTH_TOKEN: optionalValue,
  PUBLIC_ORIGIN: optionalValue,
  RENDER_EXTERNAL_URL: optionalValue,
  UNSUBSCRIBE_SIGNING_KEY: optionalValue,
  CREDENTIAL_ENCRYPTION_KEY: optionalValue,
  ENABLE_LIVE_SENDS: z.enum(['true', 'false']).default('false'),
  DELIVERY_MODE: z.enum(['dry-run', 'live']).default('dry-run'),
  CONTACT_ALLOWED_HOSTS: z.string().default(''),
  YOUTUBE_API_KEY: optionalValue,
  LLM_API_KEY: optionalValue,
  OPENAI_API_KEY: optionalValue,
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  GMAIL_CLIENT_ID: optionalValue,
  GMAIL_CLIENT_SECRET: optionalValue,
  GMAIL_REFRESH_TOKEN: optionalValue,
  SUPABASE_URL: optionalValue,
  SUPABASE_SERVICE_ROLE_KEY: optionalValue,
});
export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success)
    throw new AppError(
      500,
      `Configuração inválida: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  const config = parsed.data;
  // O Render só informa o hostname definitivo ao criar o serviço.
  // Uma origem explícita continua tendo prioridade para domínios personalizados.
  if (!config.PUBLIC_ORIGIN && config.RENDER_EXTERNAL_URL) {
    config.PUBLIC_ORIGIN = config.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  }
  if (
    !['127.0.0.1', '::1', 'localhost'].includes(config.HOST) &&
    (config.API_AUTH_TOKEN?.length ?? 0) < 32
  ) {
    throw new AppError(500, 'HOST externo exige API_AUTH_TOKEN com pelo menos 32 caracteres.');
  }
  if (config.APP_MODE === 'live' && !config.YOUTUBE_API_KEY) {
    throw new AppError(500, 'APP_MODE=live exige YOUTUBE_API_KEY.');
  }
  if (
    config.STORAGE_DRIVER === 'supabase' &&
    (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    throw new AppError(500, 'Supabase exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (config.SUPABASE_URL) {
    try {
      const url = new URL(config.SUPABASE_URL);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    } catch {
      throw new AppError(500, 'SUPABASE_URL deve ser uma URL HTTPS sem credenciais.');
    }
  }
  if (config.PUBLIC_ORIGIN) {
    try {
      const url = new URL(config.PUBLIC_ORIGIN);
      if (url.protocol !== 'https:' || url.origin !== config.PUBLIC_ORIGIN) throw new Error();
    } catch {
      throw new AppError(500, 'PUBLIC_ORIGIN deve ser uma origem HTTPS sem caminho.');
    }
  }
  if (config.UNSUBSCRIBE_SIGNING_KEY && config.UNSUBSCRIBE_SIGNING_KEY.length < 32)
    throw new AppError(500, 'UNSUBSCRIBE_SIGNING_KEY exige pelo menos 32 caracteres.');
  if (
    config.CREDENTIAL_ENCRYPTION_KEY &&
    Buffer.from(config.CREDENTIAL_ENCRYPTION_KEY, 'base64').length !== 32
  )
    throw new AppError(500, 'CREDENTIAL_ENCRYPTION_KEY deve conter 32 bytes em base64.');
  return config;
}
