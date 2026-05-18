create table if not exists public.games (
  id text primary key,
  lobby_code text not null unique,
  state jsonb not null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_actions (
  id uuid primary key default gen_random_uuid(),
  game_id text not null references public.games(id) on delete cascade,
  actor_id text not null,
  action jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.games enable row level security;
alter table public.game_actions enable row level security;

create policy "anonymous players can read games"
  on public.games
  for select
  to anon, authenticated
  using (true);

create policy "anonymous players can create games"
  on public.games
  for insert
  to anon, authenticated
  with check (true);

create policy "anonymous players can update games"
  on public.games
  for update
  to anon, authenticated
  using (true)
  with check (true);

create policy "anonymous players can insert actions"
  on public.game_actions
  for insert
  to anon, authenticated
  with check (true);

alter publication supabase_realtime add table public.games;
