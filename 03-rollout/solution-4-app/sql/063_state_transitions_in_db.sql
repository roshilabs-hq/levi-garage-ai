-- 063: מעברי מצב נאכפים במסד, לא רק בפעולת השרת (ביקורת אבטחה רביעית, 8.10, ממצאים 2, 4, 5).
--
-- 2 (גבוה). "האבחון הסתיים" (inspected_at) נבדק רק בפעולת השרת: כל תשעת הפריטים סומנו, ולכל צהוב או
--    אדום יש תיעוד. במסד מכונאי יכול היה לכתוב inspected_at ישירות, ו"מוכן" (054) נשען על השדה הזה.
--    עכשיו: complete_inspection בודקת את הפריטים במסד וכותבת את שני השדות. כתיבה ישירה ל-inspected_at,
--    ל-inspected_by או ל-inspections.completed_at, בשם משתמש, נחסמת.
-- 4. "נמסר" רק מ"מוכן". עד היום אפשר היה לדלג ישר ל"נמסר", ולעקוף את כללי "מוכן".
-- 5. "הורדה לחניה" שואלת "הרכב סגור, מורכב, ואפשר לנסוע בו?" (ביקורת UX, 1.16.2), אבל רק בפעולת השרת.
--    עכשיו מכונאי מוריד רכב מליפט רק דרך lower_car (דורשת את האישור) או finish_on_lift ("סיימתי").
--    עדכון ישיר של lift ל-null בשם מכונאי נחסם. מנהל (הוצאה החוצה, "מוכן") לא מושפע.
--
-- רשימת הפריטים כאן חייבת להתאים ל-INSPECTION_ITEMS ב-levi-garage/lib/staff/inspection.ts.
-- בלי drop.

-- 2. האבחון ---------------------------------------------------------------------------------
create or replace function public.complete_inspection(p_job_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_key text;
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager', 'mechanic') or not public.can_touch_job(p_job_id) then
    raise exception 'not your car' using errcode = '42501', hint = 'not-your-car';
  end if;
  select items into v_items from public.inspections where job_card_id = p_job_id for update;
  foreach v_key in array array['brakes', 'tires', 'steering', 'lights', 'fluids', 'leaks', 'battery', 'wipers', 'scan'] loop
    if coalesce(v_items -> v_key ->> 'light', '') not in ('green', 'yellow', 'red') then
      raise exception 'inspection item % is not marked', v_key using errcode = '22023', hint = 'inspect-incomplete';
    end if;
    if v_items -> v_key ->> 'light' in ('yellow', 'red') and coalesce(v_items -> v_key ->> 'finding_id', '') = '' then
      raise exception 'inspection item % has no finding', v_key using errcode = '22023', hint = 'inspect-incomplete';
    end if;
  end loop;

  update public.inspections set completed_at = now() where job_card_id = p_job_id;
  update public.job_cards set inspected_at = now(), inspected_by = (select auth.uid()) where id = p_job_id;
  return 'ok';
end;
$$;
revoke all on function public.complete_inspection(bigint) from public, anon;
grant execute on function public.complete_inspection(bigint) to authenticated;

create or replace function private.inspections_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.completed_at is not null)
     or (tg_op = 'UPDATE' and new.completed_at is distinct from old.completed_at) then
    raise exception 'an inspection is completed only by complete_inspection' using errcode = '42501', hint = 'inspect-rpc';
  end if;
  return new;
end;
$$;
create or replace trigger inspections_guard before insert or update on public.inspections
  for each row execute function private.inspections_guard();

-- 5. הורדה מליפט -----------------------------------------------------------------------------
create or replace function private.lower_from_lift(p_job_id bigint, p_done boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager', 'mechanic') or not public.can_touch_job(p_job_id) then
    raise exception 'not your car' using errcode = '42501', hint = 'not-your-car';
  end if;
  update public.job_cards
     set lift = null, parked_at = now(), work_done_at = case when p_done then now() else work_done_at end
   where id = p_job_id
     and lift is not null
     and status in ('open', 'in_progress', 'waiting_quote', 'waiting_approval')
     and (public.my_role() <> 'mechanic' or lift = public.my_lift());
  return found;
end;
$$;
revoke all on function private.lower_from_lift(bigint, boolean) from public, anon, authenticated;

-- "להוריד לחניה": רק אחרי "כן, הרכב סגור, מורכב, ואפשר לנסוע בו".
create or replace function public.lower_car(p_job_id bigint, p_fit boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(p_fit, false) then
    raise exception 'confirm the car is closed and fit to drive' using errcode = '22023', hint = 'fit-required';
  end if;
  return private.lower_from_lift(p_job_id, false);
end;
$$;

-- "סיימתי": העבודה גמורה, הרכב יורד לחניה ומחכה לבדיקה של דניאל.
create or replace function public.finish_on_lift(p_job_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.lower_from_lift(p_job_id, true);
end;
$$;
revoke all on function public.lower_car(bigint, boolean) from public, anon;
revoke all on function public.finish_on_lift(bigint) from public, anon;
grant execute on function public.lower_car(bigint, boolean) to authenticated;
grant execute on function public.finish_on_lift(bigint) to authenticated;

-- 2, 4, 5: השומר של כרטיס העבודה ----------------------------------------------------------------
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
    -- 063 (5): מכונאי מוריד רכב מליפט רק דרך lower_car או finish_on_lift
    if old.lift is not null and new.lift is null then
      raise exception 'a car comes off a lift through lower_car or finish_on_lift' using errcode = '42501', hint = 'lift-rpc';
    end if;
  end if;

  -- 063 (2): האבחון מסתיים רק ב-complete_inspection. מחיקה (null) מותרת, חוץ מרכב מוכן (למטה).
  if (tg_op = 'INSERT' and (new.inspected_at is not null or new.inspected_by is not null))
     or (tg_op = 'UPDATE' and new.inspected_at is not null
         and (new.inspected_at is distinct from old.inspected_at or new.inspected_by is distinct from old.inspected_by)) then
    raise exception 'an inspection is completed only by complete_inspection' using errcode = '42501', hint = 'inspect-rpc';
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
  -- ונשאר נכון אחרי זה (056): לרכב מוכן או שנמסר לא מוחקים את האבחון.
  if tg_op = 'UPDATE' and new.status in ('ready', 'delivered') and new.inspected_at is null and old.inspected_at is not null then
    raise exception 'a ready car keeps its inspection' using errcode = '22023', hint = 'ready-inspect';
  end if;
  -- 063 (4): "נמסר" רק מ"מוכן"
  if new.status = 'delivered' and (tg_op = 'INSERT' or (old.status is distinct from 'delivered' and old.status is distinct from 'ready')) then
    raise exception 'a car is delivered only after it is ready' using errcode = '22023', hint = 'deliver-ready';
  end if;
  return new;
end;
$$;
