import { setTimeout } from 'node:timers/promises';

export async function retryRead<T>(
  operation: () => Promise<T>,
  retryable: (error: unknown) => boolean,
  sleep: (ms: number) => Promise<unknown> = setTimeout,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 2 || !retryable(error)) throw error;
      await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 200));
    }
  }
}
