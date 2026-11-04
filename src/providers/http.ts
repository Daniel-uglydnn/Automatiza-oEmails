import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { AppError } from '../domain/errors.js';

// Usa as configurações de proxy e confiança TLS do ambiente. Nunca desativa TLS.
export function configureProxy(): void {
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
}

export type Fetch = typeof globalThis.fetch;
export async function requestJson(fetcher: Fetch, url: string | URL, options: RequestInit, service: string): Promise<unknown> {
  try {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
    const response = await fetcher(url, { ...options, signal });
    if (!response.ok) {
      // O corpo de erros externos pode conter credenciais ou dados pessoais.
      await response.body?.cancel();
      throw new AppError(502, `${service} respondeu HTTP ${response.status}. Verifique credenciais, permissões e cota.`);
    }
    return await response.json() as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, `Não foi possível consultar ${service}. Verifique a rede e tente novamente.`);
  }
}
