import type { Config } from './config.js';
import { DemoDiscovery } from './providers/demo.js';
import { YouTubeDiscovery } from './providers/youtube.js';
import { OpenAIWriter } from './providers/messages.js';
import { LocalRepository } from './repositories/local.js';
import { SupabaseRepository } from './repositories/supabase.js';
import { ProspectingService } from './services/prospecting.js';

export function createService(config: Config): ProspectingService {
  const repository = config.STORAGE_DRIVER === 'supabase'
    ? new SupabaseRepository(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!)
    : new LocalRepository(config.DATA_DIR);
  const discovery = config.APP_MODE === 'live' ? new YouTubeDiscovery(config.YOUTUBE_API_KEY!) : new DemoDiscovery();
  const key = config.LLM_API_KEY ?? config.OPENAI_API_KEY;
  return new ProspectingService(repository, discovery, config.APP_MODE, key ? new OpenAIWriter(key, config.OPENAI_MODEL) : null);
}
