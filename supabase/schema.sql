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

-- 24/7 twin. The latest input per camera or sensor, so the server can work out each room every minute
-- with no browser open. Key: '<roomId>/cam-<n>' for a camera, 'sensor:<roomId>:<source>' for a sensor.
create table if not exists public.room_inputs (
  workspace text not null,
  key text not null,
  room_id text not null,
  kind text not null check (kind in ('camera', 'sensor')),
  reading jsonb not null,
  ts timestamptz not null default now(),
  primary key (workspace, key)
);
alter table public.room_inputs enable row level security;

-- The twin's last computed state per workspace (rooms, open alerts, commands in hold), written by the
-- minute tick and read by a browser when it opens, so a reload starts from the live state.
create table if not exists public.twin_state (
  workspace text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.twin_state enable row level security;

-- Hourly roll-up per room, for the Trends page and month-long audit evidence.
create table if not exists public.room_hourly (
  workspace text not null,
  room_id text not null,
  hour timestamptz not null,
  kwh double precision not null default 0,
  cost double precision not null default 0,
  waste_kwh double precision not null default 0,
  waste_cost double precision not null default 0,
  occupied_minutes integer not null default 0,
  observed_minutes integer not null default 0,
  primary key (workspace, room_id, hour)
);
alter table public.room_hourly enable row level security;

-- Bring your own keys. The value is AES-256-GCM ciphertext (iv, tag and data, base64), encrypted with a key
-- derived from WORKSPACE_SECRET and the workspace id; it never leaves the server in clear.
create table if not exists public.secrets (
  workspace text not null,
  name text not null,
  ciphertext text not null,
  last4 text,
  base_url text,
  tested_at timestamptz,
  ok boolean,
  error text,
  updated_at timestamptz not null default now(),
  primary key (workspace, name)
);
alter table public.secrets enable row level security;

-- Who changed which setting or key, and when (never the value).
create table if not exists public.settings_log (
  id uuid primary key default gen_random_uuid(),
  workspace text not null,
  ts timestamptz not null default now(),
  action text not null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists settings_log_ws_ts_idx on public.settings_log (workspace, ts desc);
alter table public.settings_log enable row level security;

-- The minute tick. Run once, after deploying, with your address and CRON_SECRET filled in.
-- Needs the pg_cron and pg_net extensions (Database, Extensions in Supabase; both are on the free plan).
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.schedule('pratibimb-tick', '* * * * *', $$
--   select net.http_post(
--     url := 'https://<your-app>.vercel.app/api/tick',
--     headers := jsonb_build_object('authorization', 'Bearer <CRON_SECRET>', 'content-type', 'application/json'),
--     body := '{}'::jsonb
--   );
-- $$);
