-- 056: מהביקורת השלישית (8.10, 82/100), ממצאים 3 ו-6.
--
-- 1. "מוכן" נשאר נכון גם אחרי שהרכב מוכן (ממצא 3).
--    054 בדקה את התנאים רק במעבר ל"מוכן". אחרי זה אפשר היה, בקריאה ישירה, למחוק את האבחון של רכב
--    מוכן, או להחזיר ממצא שלו לטיוטה, ו"מוכן" נשאר. עכשיו:
--      · לרכב מוכן או שנמסר אי אפשר למחוק את האבחון.
--      · לרכב מוכן או שנמסר אי אפשר להוסיף ממצא פתוח (טיוטה או נשלח), או להחזיר ממצא למצב פתוח.
--        המסכים ממילא לא מאפשרים את זה (ADDABLE בכרטיס, ו-add_price_list_finding במסד). מי שצריך
--        להוסיף עבודה לרכב מוכן מחזיר אותו קודם לעבודה, כמו היום.
--    כמו כל השמירות מ-043: רק בכתיבה בשם משתמש. סקריפטים בשם השרת ופונקציות מאושרות לא נחסמים.
--
-- 2. קובץ יתום באחסון (ממצא 6).
--    התמונה או ההקלטה עולות לאחסון לפני שנרשמת שורה בטבלת media. אם הרישום נכשל, הקובץ נשאר בלי
--    שורה. עכשיו השרת מוחק אותו מיד, בשם המשתמש שהעלה. המדיניות צרה בכוונה: רק קובץ שהמשתמש עצמו
--    העלה, בעשר הדקות האחרונות, ושאין לו שורה ב-media. אף אחד לא יכול למחוק תמונה של ממצא.
--
-- בלי drop: create or replace, ומדיניות חדשה.

-- 1 ---------------------------------------------------------------------------
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
  -- ונשאר נכון אחרי זה (056): לרכב מוכן או שנמסר לא מוחקים את האבחון.
  if tg_op = 'UPDATE' and new.status in ('ready', 'delivered') and new.inspected_at is null and old.inspected_at is not null then
    raise exception 'a ready car keeps its inspection' using errcode = '22023', hint = 'ready-inspect';
  end if;
  return new;
end;
$$;

create or replace function private.findings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
begin
  if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'sent' and new.discount_request_at is not null then
    raise exception 'waiting for the owner on a discount' using errcode = '22023', hint = 'discount-pending';
  end if;
  if current_user <> 'authenticated' then
    return new;
  end if;
  v_role := public.my_role();

  -- 056: ממצא פתוח לא נוסף לרכב מוכן או שנמסר, וממצא לא חוזר בו למצב פתוח. קודם מחזירים לעבודה.
  if new.status in ('draft', 'sent')
     and (tg_op = 'INSERT' or old.status is distinct from new.status or old.job_card_id is distinct from new.job_card_id)
     and exists (select 1 from public.job_cards j where j.id = new.job_card_id and j.status in ('ready', 'delivered')) then
    raise exception 'the car is already ready; return it to work first' using errcode = '22023', hint = 'job-ready';
  end if;

  if tg_op = 'INSERT' then
    if v_role = 'mechanic' and (new.status <> 'draft' or new.sent_at is not null or coalesce(new.discount_pct, 0) <> 0) then
      raise exception 'a new finding is a draft' using errcode = '42501', hint = 'mechanic-locked';
    end if;
    return new;
  end if;
  if v_role = 'mechanic' then
    raise exception 'a mechanic does not edit findings' using errcode = '42501', hint = 'mechanic-locked';
  end if;
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

-- 2 ---------------------------------------------------------------------------
-- האם יש לקובץ שורה ב-media, בלי תלות במה שהמשתמש רשאי לקרוא (מכונאי לא רואה מדיה של רכב שעבר ליפט).
create or replace function public.media_path_exists(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.media m where m.storage_path = p_path)
$$;
revoke all on function public.media_path_exists(text) from public, anon;
grant execute on function public.media_path_exists(text) to authenticated;

create policy job_media_own_orphan_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'job-media'
    and public.is_worker()
    and owner_id = (select auth.uid())::text
    and created_at > now() - interval '10 minutes'
    and not public.media_path_exists(name)
  );
