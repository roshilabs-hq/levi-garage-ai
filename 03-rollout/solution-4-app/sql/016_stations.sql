-- עמדות קבועות וכניסה מהירה (27.9).
--
-- ההחלטה של רועי: העובדים לא מסתובבים עם טלפון. בכל ליפט ובעמדת האבחון יש
-- מכשיר עמיד על מתקן, ששייך לעמדה ולא לאדם. המכונאי נוגע בשם שלו ומקיש קוד
-- של 6 ספרות — כדי שיהיה ידוע מי טיפל ובמה, ואפשר יהיה למדוד.
--
-- האבטחה: קוד של 6 ספרות לבד חלש. לכן הוא עובד רק ממכשיר שמנהל העבודה "צימד"
-- לעמדה: בצימוד נוצר טוקן אקראי (48 תווים), שנשמר בעוגייה במכשיר, ובמסד רק
-- ה-hash שלו. בלי המכשיר, הקוד לא שווה כלום. ו-5 טעויות נועלות את הקוד ל-15 דקות.
-- הסיסמה האמיתית של המכונאי נגזרת בשרת מסוד (STATION_SECRET) ולא ידועה לאף אחד.

alter table public.staff add column if not exists pin_hash text;
alter table public.staff add column if not exists pin_failed int not null default 0;
alter table public.staff add column if not exists pin_locked_until timestamptz;

create table if not exists public.stations (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  lift smallint check (lift between 1 and 4),   -- ריק = עמדת האבחון
  token_hash text not null unique,
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.stations enable row level security;
drop policy if exists stations_manager_read on public.stations;
create policy stations_manager_read on public.stations
  for select to authenticated using (public.my_role() in ('owner', 'manager'));
drop policy if exists stations_manager_revoke on public.stations;
create policy stations_manager_revoke on public.stations
  for update to authenticated
  using (public.my_role() in ('owner', 'manager'))
  with check (public.my_role() in ('owner', 'manager'));

-- pin_hash לא נקרא מבחוץ: גם מנהל עבודה לא צריך לראות אותו. ב-Postgres ביטול
-- הרשאה לעמודה אחת לא עובד כשיש הרשאה לכל הטבלה, ולכן: מבטלים את הטבלה,
-- ונותנים עמודה-עמודה את מה שהאפליקציה קוראת. RLS ממשיך לסנן שורות כמו קודם.
revoke select on public.staff from anon, authenticated;
grant select (id, full_name, role, lift, lang, active, created_at, screen) on public.staff to authenticated;

-- צימוד מכשיר לעמדה. מחזיר את הטוקן פעם אחת, והוא לא נשמר במסד.
create or replace function public.create_station(p_label text, p_lift smallint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can set up a station' using errcode = '42501';
  end if;
  if coalesce(btrim(p_label), '') = '' or (p_lift is not null and p_lift not between 1 and 4) then
    raise exception 'station needs a name, and a lift 1 to 4 or none' using errcode = '22023';
  end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.stations (label, lift, token_hash, created_by)
  values (btrim(p_label), p_lift, encode(extensions.digest(v_token, 'sha256'), 'hex'), (select auth.uid()));
  return v_token;
end;
$$;

revoke all on function public.create_station(text, smallint) from public;
revoke execute on function public.create_station(text, smallint) from anon;
grant execute on function public.create_station(text, smallint) to authenticated;

-- מה העמדה מציגה לפני כניסה: השם שלה, ושמות המכונאים. רק למכשיר מצומד.
create or replace function public.station_info(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'label', st.label,
    'lift', st.lift,
    'mechanics', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'has_pin', s.pin_hash is not null) order by s.full_name)
      from public.staff s
      where s.active and s.role = 'mechanic'
    ), '[]'::jsonb)
  )
  from public.stations st
  where p_token ~ '^[0-9a-f]{48}$'
    and st.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and st.revoked_at is null
$$;

revoke all on function public.station_info(text) from public;
grant execute on function public.station_info(text) to anon, authenticated;

-- הכניסה: מכשיר מצומד + מכונאי + קוד. מחזיר את המייל (לשרת, שמתחבר בשמו).
create or replace function public.station_login(p_token text, p_staff_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station public.stations%rowtype;
  v_staff public.staff%rowtype;
  v_email text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    return jsonb_build_object('ok', false, 'reason', 'station');
  end if;
  select * into v_station from public.stations
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'station');
  end if;

  select * into v_staff from public.staff where id = p_staff_id and active and role = 'mechanic' for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'who');
  end if;
  if v_staff.pin_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'no_pin');
  end if;
  if v_staff.pin_locked_until is not null and v_staff.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'until', v_staff.pin_locked_until);
  end if;

  if p_pin is null or p_pin !~ '^\d{6}$' or extensions.crypt(p_pin, v_staff.pin_hash) <> v_staff.pin_hash then
    update public.staff
       set pin_failed = case when pin_failed + 1 >= 5 then 0 else pin_failed + 1 end,
           pin_locked_until = case when pin_failed + 1 >= 5 then now() + interval '15 minutes' else pin_locked_until end
     where id = v_staff.id;
    return jsonb_build_object('ok', false, 'reason', case when v_staff.pin_failed + 1 >= 5 then 'locked' else 'pin' end,
                              'left', greatest(0, 4 - v_staff.pin_failed));
  end if;

  update public.staff set pin_failed = 0, pin_locked_until = null where id = v_staff.id;
  update public.stations set last_used_at = now() where id = v_station.id;
  select email into v_email from auth.users where id = v_staff.id;
  return jsonb_build_object('ok', true, 'email', v_email, 'lift', v_station.lift, 'station', v_station.label);
end;
$$;

revoke all on function public.station_login(text, uuid, text) from public;
grant execute on function public.station_login(text, uuid, text) to anon, authenticated;

-- מנהל עבודה קובע (או מאפס) קוד למכונאי.
create or replace function public.set_staff_pin(p_staff_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can set a code' using errcode = '42501';
  end if;
  if p_pin is null or p_pin !~ '^\d{6}$' then
    raise exception 'the code is 6 digits' using errcode = '22023';
  end if;
  update public.staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), pin_failed = 0, pin_locked_until = null
   where id = p_staff_id and role = 'mechanic';
  if not found then
    raise exception 'no such mechanic' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_staff_pin(uuid, text) from public;
revoke execute on function public.set_staff_pin(uuid, text) from anon;
grant execute on function public.set_staff_pin(uuid, text) to authenticated;

-- למסך העמדות של דניאל: למי כבר יש קוד, ומי נעול. בלי לחשוף את ה-hash.
create or replace function public.staff_pin_status()
returns table (id uuid, full_name text, has_pin boolean, locked_until timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    raise exception 'only a manager or the owner' using errcode = '42501';
  end if;
  return query
    select s.id, s.full_name, s.pin_hash is not null, case when s.pin_locked_until > now() then s.pin_locked_until end
    from public.staff s where s.active and s.role = 'mechanic' order by s.full_name;
end;
$$;

revoke all on function public.staff_pin_status() from public;
revoke execute on function public.staff_pin_status() from anon;
grant execute on function public.staff_pin_status() to authenticated;
