-- Колчан: права создателя поездки и защита записей поездки. Запустить один раз в Supabase → SQL Editor → New query → Run (после trips.sql).
-- Сменить ссылку-приглашение (старая перестаёт работать) и убрать участника — только владелец поездки.

create or replace function public.trip_new_invite(p_trip text)
  returns text language plpgsql security definer set search_path = public as $$
declare v text := replace(gen_random_uuid()::text, '-', '');
begin
  update public.trips set invite = v where id = p_trip and owner = auth.uid();
  if not found then return null; end if;
  return v;
end $$;
revoke all on function public.trip_new_invite(text) from public;
grant execute on function public.trip_new_invite(text) to authenticated;

-- убрать участника: заодно меняется ссылка, чтобы он не вернулся по старой
create or replace function public.trip_kick(p_trip text, p_user uuid)
  returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_user = auth.uid() then return false; end if;
  if not exists (select 1 from public.trips where id = p_trip and owner = auth.uid()) then return false; end if;
  delete from public.trip_members where trip_id = p_trip and user_id = p_user;
  update public.trips set invite = replace(gen_random_uuid()::text, '-', '') where id = p_trip;
  return true;
end $$;
revoke all on function public.trip_kick(text, uuid) from public;
grant execute on function public.trip_kick(text, uuid) to authenticated;

-- Защита на сервере: в поездку можно записать только вещи этой поездки.
-- Колчан поездки — только сама поездка (id = trip_id, kind = trip); места, сумки, вещи — только с q = эта поездка.
-- Удаление (deleted = true) — всегда можно. Размер одной записи — до 64 КБ.
create or replace function public.trip_record_ok(p_trip text, p_coll text, p_id text, p_data jsonb, p_deleted boolean)
  returns boolean language sql immutable as $$
  select p_coll in ('places', 'bags', 'items', 'quivers')
     and length(p_id) between 1 and 64
     and pg_column_size(p_data) <= 65536
     and (p_deleted
          or (p_coll = 'quivers' and p_id = p_trip and p_data->>'kind' = 'trip')
          or (p_coll <> 'quivers' and p_data->>'q' = p_trip));
$$;

drop policy if exists trip_records_members on public.trip_records;
drop policy if exists trip_records_read on public.trip_records;
create policy trip_records_read on public.trip_records for select to authenticated
  using (public.is_trip_member(trip_id));
drop policy if exists trip_records_add on public.trip_records;
create policy trip_records_add on public.trip_records for insert to authenticated
  with check (public.is_trip_member(trip_id) and public.trip_record_ok(trip_id, coll, id, data, deleted));
drop policy if exists trip_records_edit on public.trip_records;
create policy trip_records_edit on public.trip_records for update to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id) and public.trip_record_ok(trip_id, coll, id, data, deleted));
drop policy if exists trip_records_del on public.trip_records;
create policy trip_records_del on public.trip_records for delete to authenticated
  using (public.is_trip_member(trip_id));
