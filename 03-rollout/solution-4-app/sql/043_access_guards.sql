-- 043: מי רשאי לכתוב מה, במסד ולא רק במסך (בדיקת OWASP, 4.10).
--
-- עד היום מדיניות העדכון של job_cards, findings ו-bookings הייתה is_worker():
-- כל עובד, כולל מכונאי. המסכים הסתירו ממנו כפתורים, אבל מי שמחזיק את הסשן
-- (טאבלט של עמדה שנשאר מחובר) יכול לשלוח PATCH ישר ל-PostgREST: לסמן שהלקוח
-- אישר, לשנות טלפון, לסמן "מוכן", או לשנות מחיר של ממצא שכבר נשלח.
--
-- הכלל כאן: השמירה חלה רק על כתיבה ישירה מהדפדפן או מהשרת בשם המשתמש
-- (current_user = 'authenticated'). פונקציות SECURITY DEFINER רצות כבעלים
-- (postgres), ולכן הזרימות המאושרות (אישור הלקוח בקישור, "חתם", הוספה מהמחירון)
-- ממשיכות לעבוד בדיוק כמו קודם.

-- 1. כרטיס עבודה --------------------------------------------------------------
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

  -- האישור של הלקוח נרשם רק בקישור שלו (intake_decide) או בעותק החתום
  -- (mark_intake_signed). אף עובד לא כותב אותו ישירות.
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
    -- המכונאי מזיז את הרכב (ליפט, חניה, סיימתי, אבחון) ומעביר בין "בעבודה"
    -- ל"מחכה לשליחה". "מוכן", "נמסר" ו"בוטל" הם של דניאל ואבי.
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
  return new;
end;
$$;

create or replace trigger job_cards_guard before insert or update on public.job_cards
  for each row execute function private.job_cards_guard();

-- 2. ממצא ----------------------------------------------------------------------
create or replace function private.findings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
begin
  -- ממצא שמחכה לאבי על הנחה לא יוצא ללקוח, בשום מסלול (גם לא בפונקציה הישנה).
  if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'sent' and new.discount_request_at is not null then
    raise exception 'waiting for the owner on a discount' using errcode = '22023', hint = 'discount-pending';
  end if;

  if current_user <> 'authenticated' then
    return new;
  end if;
  v_role := public.my_role();

  if tg_op = 'INSERT' then
    -- ממצא חדש מהעמדה הוא תמיד טיוטה, בלי הנחה. המחיר נקבע אצל דניאל.
    if v_role = 'mechanic' and (new.status <> 'draft' or new.sent_at is not null or coalesce(new.discount_pct, 0) <> 0) then
      raise exception 'a new finding is a draft' using errcode = '42501', hint = 'mechanic-locked';
    end if;
    return new;
  end if;

  if v_role = 'mechanic' then
    raise exception 'a mechanic does not edit findings' using errcode = '42501', hint = 'mechanic-locked';
  end if;

  -- מה שנשלח ללקוח קפוא: הלקוח מאשר בדיוק את מה שראה.
  if old.status <> 'draft' and (
       new.price_original is distinct from old.price_original
    or new.price_aftermarket is distinct from old.price_aftermarket
    or new.list_price_original is distinct from old.list_price_original
    or new.list_price_aftermarket is distinct from old.list_price_aftermarket
    or new.labor_hours is distinct from old.labor_hours
    or new.warranty_original is distinct from old.warranty_original
    or new.warranty_aftermarket is distinct from old.warranty_aftermarket
    or new.part_diff is distinct from old.part_diff
    or new.single_reason is distinct from old.single_reason
    or new.title is distinct from old.title
    or new.customer_text is distinct from old.customer_text
    or new.quantity is distinct from old.quantity
    or new.discount_pct is distinct from old.discount_pct) then
    raise exception 'the price was already sent to the customer' using errcode = '22023', hint = 'discount-sent';
  end if;
  return new;
end;
$$;

create or replace trigger findings_guard before insert or update on public.findings
  for each row execute function private.findings_guard();

-- 3. תור ------------------------------------------------------------------------
create or replace function private.bookings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and public.my_role() = 'mechanic' then
    raise exception 'only the foreman changes bookings' using errcode = '42501', hint = 'mechanic-locked';
  end if;
  return new;
end;
$$;

create or replace trigger bookings_guard before insert or update on public.bookings
  for each row execute function private.bookings_guard();

-- 4. הודעת "הרכב מוכן": רק דניאל ואבי -------------------------------------------
create or replace function public.claim_ready_notice(p_job_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.job_cards%rowtype;
  v_id bigint;
begin
  if public.my_role() is distinct from 'owner' and public.my_role() is distinct from 'manager' then
    raise exception 'only the foreman tells a customer the car is ready' using errcode = '42501';
  end if;

  select * into v_job from public.job_cards where id = p_job_id and status = 'ready';
  if not found then
    return null;
  end if;

  insert into public.customer_notices (job_card_id, kind, ref, created_by)
  values (p_job_id, 'ready', '', (select auth.uid()))
  on conflict (job_card_id, kind, ref) do update
    set status = 'pending',
        reason = null,
        sent_at = null,
        created_at = now(),
        created_by = excluded.created_by
    where public.customer_notices.status = 'failed'
       or (public.customer_notices.status = 'pending'
           and public.customer_notices.created_at < now() - interval '2 minutes')
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  if not v_job.whatsapp_consent then
    update public.customer_notices set status = 'skipped', reason = 'no_consent' where id = v_id;
    return jsonb_build_object('id', v_id, 'send', false);
  end if;

  if coalesce(btrim(v_job.customer_phone), '') = '' then
    update public.customer_notices set status = 'skipped', reason = 'no_phone' where id = v_id;
    return jsonb_build_object('id', v_id, 'send', false);
  end if;

  return jsonb_build_object(
    'id', v_id,
    'send', true,
    'phone', v_job.customer_phone,
    'name', v_job.customer_name,
    'make', v_job.vehicle_make,
    'model', v_job.vehicle_model,
    'plate', v_job.plate
  );
end;
$$;

-- 5. רכב בלי תור: התקנון נבדק גם במסד, לא רק בדף (039) ---------------------------
create or replace function public.intake_decide(p_token text, p_decision text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.quote_requests%rowtype;
  v_needs_terms boolean;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' or p_decision not in ('approved', 'declined') then
    return 'unavailable';
  end if;
  select * into v_req from public.quote_requests
   where token = p_token and kind = 'intake' for update;
  if not found or v_req.decided_at is not null or now() > v_req.expires_at then
    return 'unavailable';
  end if;

  if p_decision = 'approved' then
    select coalesce(b.source = 'walkin', false) and j.terms_accepted_at is null into v_needs_terms
      from public.job_cards j left join public.bookings b on b.id = j.booking_id
     where j.id = v_req.job_card_id;
    if coalesce(v_needs_terms, false) then
      return 'terms';
    end if;
  end if;

  update public.quote_requests set decided_at = now(), decision = p_decision where id = v_req.id;
  if p_decision = 'approved' then
    update public.job_cards
       set work_approved_at = now(), work_approved_via = 'link', work_approved_by = null
     where id = v_req.job_card_id and work_approved_at is null;
  end if;
  return 'done';
end;
$$;

-- 6. הדרך הישנה לשלוח ממצא בודד (לפני 027) כבר לא בשימוש באפליקציה, אבל
-- הבדיקות הישנות (approval-flow, law-gate, discount) עדיין עוברות דרכה. היא
-- בודקת בעצמה מנהל או בעלים, והחסימה של הנחה שמחכה לאבי (findings_guard)
-- חלה גם עליה. לכן נשארת פתוחה ל-authenticated, ונסגרה רק לאורחים.
revoke execute on function public.send_finding(bigint, text, text) from anon, public;
grant execute on function public.send_finding(bigint, text, text) to authenticated;
