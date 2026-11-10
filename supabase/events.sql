-- Колчан: журнал действий для поиска ошибок. Запустить один раз в Supabase → SQL Editor → New query → Run.
-- Каждый видит и пишет только свои события. Хранится 90 дней (старше чистит ночной бэкап).
create table if not exists public.events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  t timestamptz not null default now(),
  kind text not null check (length(kind) <= 40),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 8192),
  v text check (length(v) <= 40),
  dev text check (length(dev) <= 40),
  created_at timestamptz not null default now()
);
create index if not exists events_user_t on public.events (user_id, t);
create index if not exists events_created on public.events (created_at);

alter table public.events enable row level security;
drop policy if exists events_add on public.events;
create policy events_add on public.events for insert to authenticated with check (user_id = auth.uid());
drop policy if exists events_read on public.events;
create policy events_read on public.events for select to authenticated using (user_id = auth.uid());
