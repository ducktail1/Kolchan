-- Колчан: общие поездки. Запустить один раз в Supabase → SQL Editor → New query → Run.
-- Поездка живёт в своей таблице trip_records; видят и меняют её только участники.
-- Вступить можно по ссылке-приглашению: id поездки + секретный код.

create table if not exists public.trips (
  id text primary key,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  invite text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id text not null references public.trips (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.trip_records (
  trip_id text not null references public.trips (id) on delete cascade,
  coll text not null,
  id text not null,
  data jsonb not null default jsonb_build_object(),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (trip_id, coll, id)
);
create index if not exists trip_records_trip on public.trip_records (trip_id, updated_at);

-- am I in this trip? (security definer: reads trip_members without running into its own rules)
create or replace function public.is_trip_member(t text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_members m where m.trip_id = t and m.user_id = auth.uid());
$$;

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_records enable row level security;

drop policy if exists trips_read on public.trips;
create policy trips_read on public.trips for select to authenticated
  using (owner = auth.uid() or public.is_trip_member(id));
drop policy if exists trips_create on public.trips;
create policy trips_create on public.trips for insert to authenticated
  with check (owner = auth.uid());
drop policy if exists trips_owner on public.trips;
create policy trips_owner on public.trips for delete to authenticated
  using (owner = auth.uid());

drop policy if exists members_read on public.trip_members;
create policy members_read on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));
-- the owner adds himself when the trip is created; friends join through join_trip()
drop policy if exists members_owner_add on public.trip_members;
create policy members_owner_add on public.trip_members for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.trips t where t.id = trip_id and t.owner = auth.uid()));
drop policy if exists members_rename on public.trip_members;
create policy members_rename on public.trip_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists members_leave on public.trip_members;
create policy members_leave on public.trip_members for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists trip_records_members on public.trip_records;
create policy trip_records_members on public.trip_records for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

create or replace function public.trip_records_touch() returns trigger
  language plpgsql set search_path = pg_catalog as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists trip_records_touch on public.trip_records;
create trigger trip_records_touch before insert or update on public.trip_records
  for each row execute function public.trip_records_touch();

-- join by invite link: checks the secret code, adds me to the trip
create or replace function public.join_trip(p_trip text, p_invite text, p_name text)
  returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if not exists (select 1 from public.trips where id = p_trip and invite = p_invite) then return false; end if;
  insert into public.trip_members (trip_id, user_id, name) values (p_trip, auth.uid(), p_name)
    on conflict (trip_id, user_id) do update set name = excluded.name;
  return true;
end $$;
revoke all on function public.join_trip(text, text, text) from public;
grant execute on function public.join_trip(text, text, text) to authenticated;
