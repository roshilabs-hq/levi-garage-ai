-- 054: שני כללים שעד היום נאכפו רק באפליקציה (ביקורת אבטחה חיצונית חוזרת, 8.10, ממצאים 1 ו-4).
--
-- 1. הליפט של המכונאי נקבע רק בכניסה לעמדה.
--    051 הגבילה מכונאי לרכב שעל הליפט שלו (staff.lift), אבל את staff.lift קבעה האפליקציה אחרי
--    הכניסה, דרך set_my_lift, שכל מכונאי מחובר יכול היה לקרוא לה בעצמו. מי שמחזיק סשן של מכונאי
--    יכול היה "לעבור" לליפט אחר ולפעול על הרכב שעליו, בלי לעמוד שם. עכשיו:
--      · station_login קובעת את הליפט בעצמה, לפי העמדה שהטוקן שלה נבדק (כמו במציאות: עוברים ליפט
--        כשנכנסים בעמדה של הליפט האחר).
--      · set_my_lift חסומה למכונאי. נשארת למנהל ולבעלים, שממילא לא מוגבלים לליפט (051).
--
-- 2. "מוכן" רק אחרי אבחון, ורק כשאין ממצא שמחכה לדניאל או ללקוח.
--    עד היום הבדיקה הייתה רק בפעולת השרת (setJobStatus). מנהל יכול היה לשלוח PATCH ישר ל-PostgREST
--    ולסמן "מוכן" רכב שלא נבדק, או שעוד מחכה לו קישור לאישור. עכשיו job_cards_guard חוסמת את זה.
--    כמו כל השמירות של 043: רק בכתיבה בשם משתמש (current_user = 'authenticated'). סקריפטים של
--    השרת ופונקציות SECURITY DEFINER לא נחסמים.
--
-- בלי drop: create or replace בלבד.

-- 1 ---------------------------------------------------------------------------
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

  -- העמדה קובעת איפה הוא עובד (ריק = עמדת האבחון).
  update public.staff set pin_failed = 0, pin_locked_until = null, lift = v_station.lift where id = v_staff.id;
  update public.stations set last_used_at = now() where id = v_station.id;
  select email into v_email from auth.users where id = v_staff.id;
  return jsonb_build_object('ok', true, 'email', v_email, 'lift', v_station.lift, 'station', v_station.label);
end;
$$;

create or replace function public.set_my_lift(p_lift smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    raise exception 'a mechanic''s lift is set by the station he signs in at'
      using errcode = '42501', hint = 'lift-from-station';
  end if;
  if p_lift is not null and p_lift not between 1 and 4 then
    raise exception 'lift must be 1 to 4, or null for the diagnostics station'
      using errcode = '22023';
  end if;

  update public.staff
     set lift = p_lift
   where id = (select auth.uid()) and active;

  if not found then
    raise exception 'not a staff member' using errcode = '42501';
  end if;
end;
$$;

-- 2 ---------------------------------------------------------------------------
create or replace function private.job_cards_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  v_role := public.my_role();
  if tg_op = 'INSERT' then
    if new.work_approved_at is not null or new.terms_accepted_at is not null then
      raise exception 'approval is recorded only by the customer' using errcode = '42501', hint = 'approval-locked';
    end if;
  elsif new.work_approved_at is distinct from old.work_approved_at
     or new.work_approved_via is distinct from old.work_approved_via
     or new.work_approved_by is distinct from old.work_approved_by
     or new.terms_accepted_at is distinct from old.terms_accepted_at
     or new.whatsapp_revoked_at is distinct from old.whatsapp_revoked_at then
    raise exception 'approval is recorded only by the customer' using errcode = '42501', hint = 'approval-locked';
  end if;
  if v_role = 'mechanic' then
    if tg_op = 'INSERT' then
      raise exception 'only the foreman opens a job card' using errcode = '42501', hint = 'mechanic-locked';
    end if;
    if new.status is distinct from old.status and new.status not in ('open', 'in_progress', 'waiting_quote') then
      raise exception 'only the foreman marks a car ready or delivered' using errcode = '42501', hint = 'mechanic-locked';
    end if;
    if new.customer_name is distinct from old.customer_name
       or new.customer_phone is distinct from old.customer_phone
       or new.customer_email is distinct from old.customer_email
       or new.whatsapp_consent is distinct from old.whatsapp_consent
       or new.updates_consent_at is distinct from old.updates_consent_at
       or new.plate is distinct from old.plate
       or new.booking_id is distinct from old.booking_id
       or new.ready_at is distinct from old.ready_at
       or new.delivered_at is distinct from old.delivered_at
       or new.outside_at is distinct from old.outside_at
       or new.opened_by is distinct from old.opened_by
       or new.opened_at is distinct from old.opened_at
       or new.odometer_km is distinct from old.odometer_km
       or new.notes is distinct from old.notes then
      raise exception 'a mechanic cannot change the customer or the card' using errcode = '42501', hint = 'mechanic-locked';
    end if;
  end if;

  -- "מוכן": רק אחרי אבחון, ובלי ממצא שמחכה לדניאל (טיוטה) או ללקוח (נשלח).
  if new.status = 'ready' and (tg_op = 'INSERT' or old.status is distinct from 'ready') then
    if new.inspected_at is null then
      raise exception 'a car is ready only after the inspection' using errcode = '22023', hint = 'ready-inspect';
    end if;
    if tg_op = 'UPDATE' and exists (
      select 1 from public.findings f where f.job_card_id = new.id and f.status in ('draft', 'sent')
    ) then
      raise exception 'a finding still waits for the foreman or the customer' using errcode = '22023', hint = 'ready-open';
    end if;
  end if;
  return new;
end;
$$;
