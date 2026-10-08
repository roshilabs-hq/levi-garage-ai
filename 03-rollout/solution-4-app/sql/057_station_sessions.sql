-- 057: הליפט שייך לכניסה בעמדה, לא לעובד. ועמדה שבוטלה מנתקת את מי שמחובר בה.
-- (ביקורת שלישית, 8.10, 82/100, ממצאים 1 ו-2.)
--
-- 1. עד היום הליפט נשמר על העובד (staff.lift). אם אותו מכונאי נכנס בעמדה B כשהכניסה שלו בעמדה A
--    עוד פתוחה, גם הכניסה ב-A "עברה" לליפט של B, ומי שעמד ליד A יכול היה לפעול על הרכב שב-B.
--    עכשיו כל כניסה בעמדה נרשמת כאן, לפי מזהה הסשן שבטוקן (session_id), עם הליפט של העמדה שלה.
--    my_lift() קוראת קודם מכאן. כניסה בלי עמדה (סיסמה, בטלפון) נשארת עם staff.lift, כמו קודם.
--
-- 2. עד היום ביטול עמדה חסם כניסות חדשות, אבל מי שכבר היה מחובר בה המשיך לעבוד. עכשיו
--    my_role(), is_staff() ו-is_worker() מחזירות "אין תפקיד" לכניסה שהעמדה שלה בוטלה. כל מדיניות
--    RLS וכל פונקציה במסד בנויות עליהן, ולכן הכניסה מאבדת את ההרשאות מיד, גם בקריאה ישירה למסד.
--    בשרת, getStaff() (lib/staff/session.ts) מחזירה "לא מחובר" לכניסה כזו.
--
-- staff.lift ממשיך להתעדכן בכניסה (054): לפיו מפת המוסך מראה מי עובד ליד איזה ליפט.
-- בלי drop: טבלה חדשה, ו-create or replace לפונקציות.

create table if not exists public.station_sessions (
  session_id uuid primary key,
  staff_id uuid not null references public.staff (id),
  station_id uuid not null references public.stations (id) on delete cascade,
  lift smallint,
  created_at timestamptz not null default now()
);
alter table public.station_sessions enable row level security;
-- בלי מדיניות: אף משתמש לא קורא או כותב ישירות, רק הפונקציות למטה.
revoke all on public.station_sessions from anon, authenticated;

create or replace function private.my_session_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when (auth.jwt() ->> 'session_id') ~ '^[0-9a-f-]{36}$' then (auth.jwt() ->> 'session_id')::uuid end
$$;

create or replace function private.session_revoked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.station_sessions ss
      join public.stations st on st.id = ss.station_id
     where ss.session_id = private.my_session_id() and st.revoked_at is not null
  )
$$;
revoke all on function private.my_session_id() from public, anon, authenticated;
revoke all on function private.session_revoked() from public, anon, authenticated;

-- 2: התפקיד נעלם לכניסה שהעמדה שלה בוטלה ------------------------------------------
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.role from public.staff s
   where s.id = (select auth.uid()) and s.active and not private.session_revoked()
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s
    where s.id = (select auth.uid())
      and s.active
      and s.role <> 'display'
  ) and not private.session_revoked()
$$;

create or replace function public.is_worker()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s
    where s.id = (select auth.uid())
      and s.active
      and s.role in ('owner', 'manager', 'mechanic')
  ) and not private.session_revoked()
$$;

-- 1: הליפט של הכניסה ----------------------------------------------------------------
create or replace function public.my_lift()
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select case when b.session_id is not null then b.lift else s.lift end
    from public.staff s
    left join public.station_sessions b on b.session_id = private.my_session_id() and b.staff_id = s.id
   where s.id = (select auth.uid()) and s.active
$$;

-- השרת קורא לזו מיד אחרי הכניסה בעמדה (app/(he)/station/actions.ts), בשם המכונאי שנכנס, עם הטוקן
-- של העמדה מהעוגייה. הטוקן נבדק שוב כאן: בלי עמדה תקפה אין רישום.
create or replace function public.bind_station_session(p_token text)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid uuid := private.my_session_id();
  v_station public.stations%rowtype;
begin
  if v_sid is null or not exists (
    select 1 from public.staff s where s.id = (select auth.uid()) and s.active and s.role = 'mechanic'
  ) then
    raise exception 'only a mechanic signs in at a station' using errcode = '42501', hint = 'station-session';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    raise exception 'not a station' using errcode = '42501', hint = 'station-session';
  end if;
  select * into v_station from public.stations
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if not found then
    raise exception 'not a station' using errcode = '42501', hint = 'station-session';
  end if;

  insert into public.station_sessions (session_id, staff_id, station_id, lift)
  values (v_sid, (select auth.uid()), v_station.id, v_station.lift)
  on conflict (session_id) do update
    set staff_id = excluded.staff_id, station_id = excluded.station_id, lift = excluded.lift, created_at = now();
  return v_station.lift;
end;
$$;

-- למסכים (getStaff): האם הכניסה הזו בעמדה, באיזה ליפט, והאם העמדה בוטלה.
create or replace function public.my_station_session()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'bound', b.session_id is not null,
    'lift', b.lift,
    'revoked', coalesce(st.revoked_at is not null, false)
  )
    from (select 1) one
    left join public.station_sessions b on b.session_id = private.my_session_id() and b.staff_id = (select auth.uid())
    left join public.stations st on st.id = b.station_id
$$;

revoke all on function public.bind_station_session(text) from public, anon;
revoke all on function public.my_station_session() from public, anon;
grant execute on function public.bind_station_session(text) to authenticated;
grant execute on function public.my_station_session() to authenticated;
