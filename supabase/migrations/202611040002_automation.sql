begin;
create table if not exists public.app_records (
  namespace text not null, id text not null, document jsonb not null,
  primary key(namespace, id)
);
create table if not exists public.deliveries (
  id uuid primary key,
  channel_id text not null unique,
  email_key text not null unique check (email_key ~ '^[a-f0-9]{64}$'),
  document jsonb not null check (document->>'id' = id::text and document->>'channelId' = channel_id and document->>'emailKey' = email_key)
);
create table if not exists public.automation_lock (id int primary key check (id = 1), owner uuid, expires_at timestamptz);
insert into public.automation_lock (id) values (1) on conflict do nothing;
alter table public.app_records enable row level security;
alter table public.deliveries enable row level security;
alter table public.automation_lock enable row level security;
revoke all on public.app_records, public.deliveries, public.automation_lock from anon, authenticated;
grant all on public.app_records, public.deliveries, public.automation_lock to service_role;
create or replace function public.acquire_automation_lock(lock_owner uuid) returns boolean
language plpgsql security definer set search_path = public
as $$ begin
 update automation_lock set owner = lock_owner, expires_at = now() + interval '30 minutes'
 where id = 1 and (owner is null or expires_at < now()); return found;
end; $$;
create or replace function public.release_automation_lock(lock_owner uuid) returns void
language sql security definer set search_path = public
as $$ update automation_lock set owner = null, expires_at = null where id = 1 and owner = lock_owner; $$;
revoke all on function public.acquire_automation_lock(uuid), public.release_automation_lock(uuid) from public, anon, authenticated;
grant execute on function public.acquire_automation_lock(uuid), public.release_automation_lock(uuid) to service_role;
commit;
