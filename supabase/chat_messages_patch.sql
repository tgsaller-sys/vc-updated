create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.games(id) on delete cascade,
  player_id text not null,
  player_name text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_lobby_created_at_idx
  on public.chat_messages (lobby_id, created_at);

alter table public.chat_messages enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'chat_messages'
      and policyname = 'anonymous players can read lobby chat'
  ) then
    create policy "anonymous players can read lobby chat"
      on public.chat_messages
      for select
      to anon, authenticated
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'chat_messages'
      and policyname = 'anonymous players can insert lobby chat'
  ) then
    create policy "anonymous players can insert lobby chat"
      on public.chat_messages
      for insert
      to anon, authenticated
      with check (char_length(message) between 1 and 200);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end
$$;
