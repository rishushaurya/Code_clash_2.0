-- Pratibimb storage. Run once in the Supabase SQL editor (safe to run again).
-- Only the server functions touch these tables, with the service-role key, which bypasses row-level
-- security. Row-level security is on with no policies, so the public (anon) key can read or write nothing.

-- Workspaces: a name and a scrypt password hash. Sessions are signed tokens, so no session table.
create table if not exists public.workspaces (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;

-- Each workspace's site (rooms, devices, money settings) under its id, and its camera settings under <id>/cameras.
create table if not exists public.sites (
  id text primary key,
  site jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.sites enable row level security;

-- The event log: every alert, command and confirmation, the action-taken record auditors ask for.
-- payload.site names the workspace.
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  room_id text,
  kind text not null check (kind in ('status', 'alert', 'recommendation', 'command', 'ack')),
  payload jsonb not null default '{}'::jsonb
);
create index if not exists events_ts_idx on public.events (ts desc);
create index if not exists events_site_ts_idx on public.events ((payload->>'site'), ts desc);
alter table public.events enable row level security;

-- Earlier versions let the public key read every event. Workspaces read their own through /api/events.
drop policy if exists "events are readable" on public.events;
