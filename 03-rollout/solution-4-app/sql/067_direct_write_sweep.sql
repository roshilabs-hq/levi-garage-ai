-- 067: סריקה שיטתית של כתיבות ישירות (8.10, לפני ביקורת האבטחה השישית).
--
-- בחמש הביקורות חזרה אותה תבנית: כתיבה ישירה לטבלה, בשם משתמש, עוקפת כלל שנאכף רק בפונקציה
-- ("מוכן", האבחון, הורדה מליפט, תוכן האבחון). במקום לחכות לבודק הבא, עברנו על כל טבלה שמשתמש מחובר
-- רשאי לכתוב אליה, ועל כל פונקציה ב-SECURITY DEFINER שפתוחה לאורח או למשתמש. מה שנמצא ונסגר כאן:
--
-- 1. ממצאים: מנהל יכול היה לסמן ישירות "נשלח", "אושר" או "נדחה", כלומר לרשום החלטה של לקוח שלא
--    הייתה. עכשיו המעבר הישיר היחיד הוא טיוטה ← בוטל ("לא לשלוח"). שליחה והחלטה רק דרך הפונקציות
--    (send_quote_request, request_decide, approval_decide). ממצא חדש תמיד טיוטה, לכל תפקיד.
--    גם השדות של השליחה ושל בקשת ההנחה לא נכתבים ישירות. "דווח לרשות" רק על ממצא שהלקוח דחה.
-- 2. פריטי הצעת הקבלה (quote_items): אחרי שהלקוח אישר, לא משנים, לא מוסיפים ולא מוחקים. בדיוק כמו
--    ממצא שנשלח (043): הלקוח אישר את מה שראה.
-- 3. מדיה: בעדכון, רק השיוך לממצא (finding_id). לא הנתיב, לא הסוג ולא מי העלה. וברישום חדש, "נוצר על
--    ידי" הוא המשתמש עצמו.
-- 4. קריאת עזרה: רק לרכב שהמכונאי רשאי לגעת בו.
-- 5. הרשאות טבלה: לאורח אין כתיבה לאף טבלה (הכול דרך פונקציות). למשתמש מחובר אין מחיקה בטבלאות
--    העבודה, ואין כתיבה בטבלאות שאין להן מדיניות כתיבה. ה-RLS כבר חסם, זו שכבה שנייה.
-- בלי drop.

-- 1. ממצאים --------------------------------------------------------------------------------------
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

  if new.status in ('draft', 'sent')
     and (tg_op = 'INSERT' or old.status is distinct from new.status or old.job_card_id is distinct from new.job_card_id)
     and exists (select 1 from public.job_cards j where j.id = new.job_card_id and j.status in ('ready', 'delivered')) then
    raise exception 'the car is already ready; return it to work first' using errcode = '22023', hint = 'job-ready';
  end if;

  if tg_op = 'INSERT' then
    -- 067: ממצא חדש הוא טיוטה, לכל תפקיד. שליחה רק דרך הפונקציות.
    if new.status <> 'draft' or new.sent_at is not null or new.sent_by is not null
       or new.discount_request_at is not null or new.discount_request_pct is not null
       or (v_role = 'mechanic' and coalesce(new.discount_pct, 0) <> 0) then
      raise exception 'a new finding is a draft' using errcode = '42501', hint = 'finding-flow';
    end if;
    return new;
  end if;
  if v_role = 'mechanic' then
    raise exception 'a mechanic does not edit findings' using errcode = '42501', hint = 'mechanic-locked';
  end if;

  -- 067: המעבר הישיר היחיד: טיוטה ← בוטל. "נשלח", "אושר" ו"נדחה" רק דרך הפונקציות.
  if new.status is distinct from old.status and not (old.status = 'draft' and new.status = 'cancelled') then
    raise exception 'a finding is sent and decided only through its functions' using errcode = '42501', hint = 'finding-flow';
  end if;
  if new.sent_at is distinct from old.sent_at or new.sent_by is distinct from old.sent_by or new.direct is distinct from old.direct
     or new.created_by is distinct from old.created_by or new.job_card_id is distinct from old.job_card_id
     or new.discount_request_at is distinct from old.discount_request_at
     or new.discount_request_pct is distinct from old.discount_request_pct
     or new.discount_request_reason is distinct from old.discount_request_reason
     or new.discount_request_by is distinct from old.discount_request_by then
    raise exception 'these fields are written only through the functions' using errcode = '42501', hint = 'finding-flow';
  end if;
  -- "דווח לרשות הרישוי" (תקנה 6) רק על ליקוי שהלקוח דחה
  if new.safety_reported_at is distinct from old.safety_reported_at and new.safety_reported_at is not null and new.status <> 'declined' then
    raise exception 'only a declined finding is reported' using errcode = '22023', hint = 'finding-flow';
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

-- 2. פריטי הצעת הקבלה --------------------------------------------------------------------------
create or replace function private.quote_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_job bigint := case when tg_op = 'DELETE' then old.job_card_id else new.job_card_id end;
begin
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if exists (select 1 from public.job_cards j where j.id = v_job and j.work_approved_at is not null)
     or (tg_op = 'UPDATE' and old.job_card_id is distinct from new.job_card_id
         and exists (select 1 from public.job_cards j where j.id = old.job_card_id and j.work_approved_at is not null)) then
    raise exception 'the customer already approved this quote' using errcode = '22023', hint = 'quote-locked';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create or replace trigger quote_items_guard before insert or update or delete on public.quote_items
  for each row execute function private.quote_items_guard();

-- 3. מדיה ------------------------------------------------------------------------------------------
revoke update on public.media from authenticated;
grant update (finding_id) on public.media to authenticated;
alter policy media_staff_write on public.media
  with check (
    public.can_touch_job(job_card_id)
    and (created_by is null or created_by = (select auth.uid()))
    and (finding_id is null or exists (select 1 from public.findings f where f.id = media.finding_id and f.job_card_id = media.job_card_id))
  );

-- 4. קריאת עזרה ------------------------------------------------------------------------------------
alter policy help_calls_create on public.help_calls
  with check (
    public.is_worker() and requested_by = (select auth.uid()) and resolved_at is null
    and (job_card_id is null or public.can_touch_job(job_card_id))
  );

-- 5. הרשאות טבלה -----------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon', t);
    execute format('revoke truncate on public.%I from authenticated', t);
  end loop;
end
$$;
revoke delete on public.job_cards, public.findings, public.bookings, public.help_calls, public.media,
                 public.inspections, public.mentor_questions, public.staff, public.stations,
                 public.approvals, public.customer_notices, public.quote_versions from authenticated;
revoke insert, update on public.approvals, public.customer_notices, public.quote_versions, public.staff from authenticated;
revoke insert on public.bookings, public.stations from authenticated;
revoke update on public.mentor_questions from authenticated;
