-- 046: מסך הסדנה קורא רק את מה שהוא מציג (בדיקת OWASP, 4.10, ממצא M-2).
--
-- המשתמש של מסך הסדנה (display, screen='wall') נשאר מחובר כל היום על מחשב
-- בסדנה. עד היום is_staff() כלל אותו, ולכן מי שפתח כלי מפתחים על המחשב הזה
-- יכול היה לקרוא טלפונים, מיילים ושמות של כל הלקוחות. עכשיו המסך מקבל את מה
-- שהוא צריך מפונקציה אחת (כמו lobby_view של חדר ההמתנה), ו-is_staff() כבר לא
-- כולל אותו.
--
-- "היום" נקבע כאן לפי שעון ישראל. עד היום הדף חישב אותו בשעון השרת (UTC).

create or replace function public.wall_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  select exists (
    select 1 from public.staff s
     where s.id = (select auth.uid()) and s.active
       and (s.role in ('owner', 'manager', 'mechanic') or (s.role = 'display' and s.screen = 'wall'))
  ) into v_ok;
  if not v_ok then
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

revoke execute on function public.wall_board() from public, anon;
grant execute on function public.wall_board() to authenticated;

-- בזמן ההפצה (4.10), אחרי שהדף עבר לפונקציה: מסך הסדנה כבר לא "צוות" לקריאת
-- הטבלאות (job_cards, bookings, findings, media, approvals, quote_requests).
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.staff s
    where s.id = (select auth.uid())
      and s.active
      and s.role <> 'display'
  )
$function$;
