create table if not exists public.tg_logins (
  code text primary key,
  tg_id bigint not null,
  tg_name text,
  tg_username text,
  mode text,
  phone text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
alter table public.tg_logins enable row level security;
create table if not exists public.tg_users (
  tg_id bigint primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  phone text,
  created_at timestamptz not null default now()
);
alter table public.tg_users enable row level security;
