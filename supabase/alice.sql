-- Колчан: Алиса (навык в Яндекс Диалогах) с привязкой аккаунта. Запустить один раз в Supabase → SQL Editor → Run.
-- Привязки и коды пишет только функция alice-auth (ключ service_role); человек видит и может удалить только свои привязки.
create table if not exists public.alice_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  refresh_hash text unique,
  created_at timestamptz not null default now(),
  last_used timestamptz
);
create index if not exists alice_links_user on public.alice_links (user_id);
alter table public.alice_links enable row level security;
drop policy if exists alice_links_read on public.alice_links;
create policy alice_links_read on public.alice_links for select to authenticated using (user_id = auth.uid());
drop policy if exists alice_links_del on public.alice_links;
create policy alice_links_del on public.alice_links for delete to authenticated using (user_id = auth.uid());

create table if not exists public.alice_codes (
  code_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_uri text not null,
  expires_at timestamptz not null
);
alter table public.alice_codes enable row level security;   -- без политик: только функция
