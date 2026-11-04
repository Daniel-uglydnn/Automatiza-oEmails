import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { LocalRepository } from '../src/repositories/local.js';
import { DemoDiscovery } from '../src/providers/demo.js';
import { ProspectingService } from '../src/services/prospecting.js';
import type { DiscoveryProvider } from '../src/domain/models.js';

export const now = new Date('2026-11-04T15:00:00Z');
export async function fixture(
  t: TestContext,
  discovery: DiscoveryProvider = new DemoDiscovery(() => now),
) {
  const directory = await mkdtemp(join(tmpdir(), 'outreach-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new LocalRepository(directory);
  const service = new ProspectingService(repository, discovery, 'demo', null, () => now);
  return { directory, repository, service };
}
