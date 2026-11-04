import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { AppError } from '../domain/errors.js';
import { retryRead } from './retry.js';
export class ProviderError extends AppError {
  constructor(
    public readonly providerStatus: number,
    message: string,
  ) {
    super(502, message);
  }
}

// Usa as configurações de proxy e confiança TLS do ambiente. Nunca desativa TLS.
export function configureProxy(): void {
  if (
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy
  ) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
}

export type Fetch = typeof globalThis.fetch;
async function once(
  fetcher: Fetch,
  url: string | URL,
  options: RequestInit,
  service: string,
): Promise<unknown> {
  try {
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000);
    const response = await fetcher(url, { ...options, signal });
    if (!response.ok) {
      // O corpo de erros externos pode conter credenciais ou dados pessoais.
      await response.body?.cancel();
      throw new ProviderError(
        response.status,
        `${service} respondeu HTTP ${response.status}. Verifique credenciais, permissões e cota.`,
      );
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new ProviderError(
      0,
      `Não foi possível consultar ${service}. Verifique a rede e tente novamente.`,
    );
  }
}
export async function requestJson(
  fetcher: Fetch,
  url: string | URL,
  options: RequestInit,
  service: string,
): Promise<unknown> {
  // Nunca repetir POSTs de envio: um timeout não prova que o Gmail recusou a mensagem.
  if ((options.method ?? 'GET') !== 'GET') return once(fetcher, url, options, service);
  return retryRead(
    () => once(fetcher, url, options, service),
    (error) =>
      !options.signal?.aborted &&
      error instanceof ProviderError &&
      [0, 429, 500, 502, 503, 504].includes(error.providerStatus),
  );
}
