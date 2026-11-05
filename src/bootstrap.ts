import type { Config } from './config.js';
import { DemoDiscovery } from './providers/demo.js';
import { YouTubeDiscovery } from './providers/youtube.js';
import { OpenAIWriter } from './providers/messages.js';
import { LocalRepository } from './repositories/local.js';
import { SupabaseRepository } from './repositories/supabase.js';
import { ProspectingService } from './services/prospecting.js';
import { GmailConnection } from './services/oauth.js';
import { DeliveryService } from './services/delivery.js';
import { OperationsService } from './services/operations.js';
import { AutomationService } from './services/automation.js';
import { ReplyTracking } from './services/tracking.js';
import { PublicWebsiteContacts } from './providers/public-contacts.js';
import type { Fetch } from './providers/http.js';

export function createService(config: Config): ProspectingService {
  const repository =
    config.STORAGE_DRIVER === 'supabase'
      ? new SupabaseRepository(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!)
      : new LocalRepository(config.DATA_DIR);
  const discovery =
    config.APP_MODE === 'live'
      ? new YouTubeDiscovery(config.YOUTUBE_API_KEY!)
      : new DemoDiscovery();
  const key = config.LLM_API_KEY ?? config.OPENAI_API_KEY;
  return new ProspectingService(
    repository,
    discovery,
    config.APP_MODE,
    key ? new OpenAIWriter(key, config.OPENAI_MODEL) : null,
  );
}
export function createModules(
  config: Config,
  service: ProspectingService,
  publicFetch: Fetch = fetch,
) {
  const repository = service.repository;
  const gmail = new GmailConnection(config, repository);
  const transport = () => gmail.transport();
  const delivery = new DeliveryService(config, repository, transport);
  const tracking = new ReplyTracking(repository, transport);
  const contacts = new PublicWebsiteContacts(
    config.CONTACT_ALLOWED_HOSTS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const operations = new OperationsService(config, repository, gmail, publicFetch);
  const automation = new AutomationService(
    config,
    service,
    delivery,
    tracking,
    contacts,
    () => new Date(),
    transport,
  );
  return { gmail, delivery, tracking, contacts, operations, automation };
}
