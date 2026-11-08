create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  coll text not null,
  id text not null,
  data jsonb not null default jsonb_build_object(),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, coll, id)
);
alter table public.records enable row level security;
drop policy if exists own_records on public.records;
create policy own_records on public.records
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create or replace function public.records_touch() returns trigger
  language plpgsql set search_path = pg_catalog as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();
create index if not exists records_user_updated on public.records (user_id, updated_at);
