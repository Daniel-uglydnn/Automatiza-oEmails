-- Execute uma vez no SQL Editor do Supabase. Uso exclusivo por backend service_role.
begin;
create table if not exists public.campaigns (
  id uuid primary key,
  created_at timestamptz not null,
  document jsonb not null check (document->>'id' = id::text)
);
create index if not exists campaigns_created_at_idx on public.campaigns (created_at desc, id);
create table if not exists public.settings (id text primary key check (id = 'default'), document jsonb not null);
create table if not exists public.suppressions (
  email text primary key check (email = lower(email)),
  reason text not null check (reason in ('manual', 'negative', 'unsubscribe')),
  created_at timestamptz not null default now()
);
create table if not exists public.error_events (id uuid primary key, created_at timestamptz not null, document jsonb not null);
create table if not exists public.prospecting_lock (id int primary key check (id = 1), owner uuid, expires_at timestamptz);
insert into public.prospecting_lock (id) values (1) on conflict do nothing;

alter table public.campaigns enable row level security;
alter table public.settings enable row level security;
alter table public.suppressions enable row level security;
alter table public.error_events enable row level security;
alter table public.prospecting_lock enable row level security;
revoke all on public.campaigns, public.settings, public.suppressions, public.error_events, public.prospecting_lock from anon, authenticated;
grant all on public.campaigns, public.settings, public.suppressions, public.error_events, public.prospecting_lock to service_role;

create or replace function public.acquire_prospecting_lock(lock_owner uuid) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  update prospecting_lock set owner = lock_owner, expires_at = now() + interval '15 minutes'
  where id = 1 and (owner is null or expires_at < now());
  return found;
end;
$$;
create or replace function public.release_prospecting_lock(lock_owner uuid) returns void
language sql security definer set search_path = public
as $$ update prospecting_lock set owner = null, expires_at = null where id = 1 and owner = lock_owner; $$;
revoke all on function public.acquire_prospecting_lock(uuid), public.release_prospecting_lock(uuid) from public, anon, authenticated;
grant execute on function public.acquire_prospecting_lock(uuid), public.release_prospecting_lock(uuid) to service_role;
commit;
