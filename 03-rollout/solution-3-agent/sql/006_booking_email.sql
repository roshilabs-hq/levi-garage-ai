-- המייל של הלקוח מהתור (27.9).
--
-- החוק מחייב שהצעת המחיר הראשונה תינתן "במסמך מודפס או בהודעת דואר
-- אלקטרוני" (ס' 132(ב) לחוק רישוי שירותים ומקצועות בענף הרכב). Cal.com
-- מבקש מייל בכל תור, אבל עד היום Make לא העביר אותו, ולכן בקבלה לא היה לאן
-- לשלוח. כאן: עמודה בתור, ו-intake_booking שומרת אותה אם הגיעה.
-- Make מעביר אותה מ-{{1.payload.responses.email.value}} (סקריפט make-booking-email).

alter table public.bookings add column if not exists customer_email text;

create or replace function public.intake_booking(p_token text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_id bigint;
  v_event text := p->>'event';
  v_email text := lower(btrim(coalesce(p->>'customer_email', '')));
begin
  select value into v_expected from private.settings where key = 'intake_token';
  if p_token is null or v_expected is null or p_token <> v_expected then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- מייל שלא נראה כמו מייל לא נשמר: עדיף ריק מאשר כתובת שהמייל ייפול עליה.
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_email := null;
  end if;

  if v_event = 'BOOKING_CANCELLED' then
    update public.bookings set status = 'cancelled' where cal_uid = p->>'cal_uid'
    returning id into v_id;
    return jsonb_build_object('ok', v_id is not null, 'id', v_id, 'action', 'cancelled');
  end if;

  insert into public.bookings (
    cal_uid, status, drop_off_at, customer_name, customer_phone, customer_email, whatsapp_consent,
    plate, service, notes, vehicle_found, vehicle_make, vehicle_model, vehicle_year,
    engine_code, fuel, tires, test_valid_until
  ) values (
    p->>'cal_uid',
    case when v_event = 'BOOKING_RESCHEDULED' then 'rescheduled' else 'booked' end,
    (p->>'drop_off_at')::timestamptz,
    nullif(p->>'customer_name', ''),
    nullif(p->>'customer_phone', ''),
    v_email,
    coalesce(nullif(p->>'whatsapp_consent', '')::boolean, false),
    regexp_replace(coalesce(p->>'plate', ''), '\D', '', 'g'),
    nullif(p->>'service', ''),
    nullif(p->>'notes', ''),
    coalesce(nullif(p->>'vehicle_found', '')::boolean, false),
    nullif(p->>'vehicle_make', ''),
    nullif(p->>'vehicle_model', ''),
    nullif(p->>'vehicle_year', '')::int,
    nullif(p->>'engine_code', ''),
    nullif(p->>'fuel', ''),
    nullif(p->>'tires', ''),
    nullif(p->>'test_valid_until', '')::date
  )
  on conflict (cal_uid) do update set
    status = excluded.status,
    drop_off_at = excluded.drop_off_at,
    customer_name = excluded.customer_name,
    customer_phone = excluded.customer_phone,
    customer_email = coalesce(excluded.customer_email, public.bookings.customer_email),
    whatsapp_consent = excluded.whatsapp_consent,
    plate = excluded.plate,
    service = excluded.service,
    notes = excluded.notes,
    vehicle_found = excluded.vehicle_found,
    vehicle_make = excluded.vehicle_make,
    vehicle_model = excluded.vehicle_model,
    vehicle_year = excluded.vehicle_year,
    engine_code = excluded.engine_code,
    fuel = excluded.fuel,
    tires = excluded.tires,
    test_valid_until = excluded.test_valid_until
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'action', 'upserted');
end $$;

revoke all on function public.intake_booking(text, jsonb) from public;
revoke execute on function public.intake_booking(text, jsonb) from authenticated;
grant execute on function public.intake_booking(text, jsonb) to anon;
