-- 064: כניסה מעמדה שבוטלה נחסמת בכל בקשה, לא רק בהרשאות (ביקורת אבטחה רביעית, 8.10, ממצא 3).
--
-- 057 גרמה ל-my_role, is_staff ו-is_worker להחזיר "אין תפקיד" לכניסה מעמדה שבוטלה. אבל כמה פונקציות
-- בודקות את התפקיד בעצמן, ישר מטבלת הצוות (wall_board, lobby_view, add_price_list_finding,
-- claim_quote_notice, send_finding, ושני טריגרים), ושם הביטול לא נראה.
--
-- 1. במקום לתקן כל אחת (ולשכוח את הבאה): בדיקה אחת לפני כל בקשה ל-PostgREST (db_pre_request). כניסה
--    שהעמדה שלה בוטלה מקבלת 401 בכל טבלה ובכל פונקציה. לאורח ולכל כניסה אחרת: בדיקה אחת לפי מפתח.
-- 2. בנוסף, מסך הסדנה וחדר ההמתנה עוברים ל-my_role, כדי שהכלל יחזיק גם אם הבדיקה הכללית תכובה.
--
-- לביטול, אם משהו נשבר: alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';

create or replace function public.check_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.session_revoked() then
    raise exception 'this station was revoked' using errcode = 'PT401', hint = 'station-revoked';
  end if;
end;
$$;
revoke all on function public.check_request() from public;
grant execute on function public.check_request() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.check_request';
notify pgrst, 'reload config';

-- 2. מסך הסדנה וחדר ההמתנה -----------------------------------------------------------------
create or replace function public.wall_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.my_role() in ('owner', 'manager', 'mechanic')
          or (public.my_role() = 'display'
              and exists (select 1 from public.staff s where s.id = (select auth.uid()) and s.screen = 'wall'))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', j.id, 'plate', j.plate, 'vehicle_make', j.vehicle_make, 'vehicle_model', j.vehicle_model,
               'status', j.status, 'lift', j.lift, 'lift_since', j.lift_since, 'status_since', j.status_since,
               'inspected_at', j.inspected_at, 'opened_at', j.opened_at, 'parked_at', j.parked_at,
               'outside_at', j.outside_at, 'priority_at', j.priority_at, 'work_done_at', j.work_done_at,
               'work_approved_at', j.work_approved_at
             ) order by j.status_since)
        from public.job_cards j
       where j.status not in ('delivered', 'cancelled')
    ), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'plate', b.plate, 'service', b.service, 'drop_off_at', b.drop_off_at,
               'vehicle_make', b.vehicle_make, 'vehicle_model', b.vehicle_model
             ) order by b.drop_off_at)
        from public.bookings b
       where b.status in ('booked', 'rescheduled')
         and (b.drop_off_at at time zone 'Asia/Jerusalem')::date = (now() at time zone 'Asia/Jerusalem')::date
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.lobby_view()
returns table (plate_last3 text, vehicle text, state text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    right(j.plate, 3) as plate_last3,
    nullif(btrim(coalesce(j.vehicle_make, '') || ' ' || coalesce(j.vehicle_model, '')), '') as vehicle,
    case when j.status = 'ready' then 'ready' else 'working' end as state
  from public.job_cards j
  where j.status in ('open', 'in_progress', 'waiting_quote', 'waiting_approval', 'ready')
    and public.my_role() is not null
    and (public.my_role() <> 'display'
         or exists (select 1 from public.staff s where s.id = (select auth.uid()) and s.screen = 'lobby'))
  order by (j.status = 'ready') desc, right(j.plate, 3);
$$;
