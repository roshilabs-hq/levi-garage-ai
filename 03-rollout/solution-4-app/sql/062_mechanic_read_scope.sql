-- 062: מה מכונאי רשאי לקרוא (ביקורת אבטחה רביעית, 8.10, ממצא 1, גבוה).
--
-- 051-059 הגבילו מה מכונאי רשאי לשנות. הקריאה נשארה is_staff() לכל איש צוות: מכונאי מחובר יכול היה
-- לבקש ישירות מ-PostgREST כל כרטיס, תור וממצא, מכל הזמנים, כולל הטלפון והמייל של הלקוח. המסכים שלו
-- לא הציגו אותם, אבל הסתרה במסך היא לא הרשאה.
--
-- מעכשיו:
--   1. שורות: מכונאי רואה רק רכבים שבמוסך עכשיו (כל מצב חוץ מ"נמסר" ו"בוטל"), ורכב שנמסר ב-24 השעות
--      האחרונות (המונה "נמסרו היום" במפת המוסך). אותו כלל לממצאים, אישורים, אבחונים, מדיה ופריטי
--      הצעה של אותו רכב. תורים: רק סביב היום (אתמול עד מחר), כמו "מגיעים היום" במפה.
--      בקשות אישור (quote_requests): רק מנהל ובעלים. למכונאי אין בהן צורך.
--   2. עמודות: הטלפון והמייל של הלקוח (job_cards, bookings) לא נקראים ישירות בכלל, לאף משתמש. דניאל
--      ואבי מקבלים אותם דרך job_contacts ו-booking_contact, שבודקות תפקיד. כמו הטוקנים ב-045.
--      הכתיבה (insert, update) לא משתנה: דניאל ממשיך לרשום טלפון בקבלה.
--   הערה לתחזוקה: עמודה חדשה ב-job_cards או ב-bookings צריכה grant select משלה, כאן למטה.
-- בלי drop: alter policy, ו-revoke/grant.

-- 1. שורות -------------------------------------------------------------------------------
create or replace function public.can_see_job(p_job_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.my_role() in ('owner', 'manager') then true
    when public.my_role() = 'mechanic' then exists (
      select 1 from public.job_cards j
       where j.id = p_job_id
         and (j.status not in ('delivered', 'cancelled') or j.delivered_at > now() - interval '24 hours')
    )
    else false
  end
$$;
revoke all on function public.can_see_job(bigint) from public, anon;
grant execute on function public.can_see_job(bigint) to authenticated;

alter policy job_cards_staff_read on public.job_cards
  using (
    public.my_role() in ('owner', 'manager')
    or (public.my_role() = 'mechanic'
        and (status not in ('delivered', 'cancelled') or delivered_at > now() - interval '24 hours'))
  );

alter policy findings_staff_read on public.findings using (public.can_see_job(job_card_id));
alter policy inspections_read on public.inspections using (public.can_see_job(job_card_id));
alter policy media_staff_read on public.media using (public.can_see_job(job_card_id));
alter policy quote_items_read on public.quote_items using (public.can_see_job(job_card_id));
alter policy approvals_staff_read on public.approvals
  using (exists (select 1 from public.findings f where f.id = finding_id and public.can_see_job(f.job_card_id)));
alter policy quote_requests_read on public.quote_requests using (public.my_role() in ('owner', 'manager'));
alter policy bookings_staff_read on public.bookings
  using (
    public.my_role() in ('owner', 'manager')
    or (public.my_role() = 'mechanic'
        and drop_off_at > now() - interval '1 day' and drop_off_at < now() + interval '2 days')
  );

-- 2. עמודות ------------------------------------------------------------------------------
revoke select on public.job_cards from authenticated, anon;
grant select (id, booking_id, plate, vehicle_make, vehicle_model, vehicle_year, engine_code, fuel, customer_name,
              whatsapp_consent, lift, status, opened_by, opened_at, ready_at, delivered_at, notes, updated_at,
              lift_since, status_since, odometer_km, updates_consent_at, inspected_at, inspected_by,
              work_approved_at, work_approved_by, parked_at, priority_at, outside_at, work_done_at,
              work_approved_via, terms_accepted_at, whatsapp_revoked_at)
  on public.job_cards to authenticated;

revoke select on public.bookings from authenticated, anon;
grant select (id, cal_uid, status, drop_off_at, customer_name, whatsapp_consent, plate, service, notes,
              vehicle_found, vehicle_make, vehicle_model, vehicle_year, engine_code, fuel, tires,
              test_valid_until, created_at, updated_at, source, whatsapp_revoked_at)
  on public.bookings to authenticated;

-- פרטי הקשר, לדניאל ולאבי בלבד. לכל אחר: כלום (לא שגיאה), כדי שמסך משותף לא ייפול.
create or replace function public.job_contacts(p_job_ids bigint[])
returns table (id bigint, customer_phone text, customer_email text)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.customer_phone, j.customer_email
    from public.job_cards j
   where j.id = any (p_job_ids) and public.my_role() in ('owner', 'manager')
$$;

create or replace function public.booking_contact(p_booking_id bigint)
returns table (customer_phone text, customer_email text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.customer_phone, b.customer_email
    from public.bookings b
   where b.id = p_booking_id and public.my_role() in ('owner', 'manager')
$$;

revoke all on function public.job_contacts(bigint[]) from public, anon;
revoke all on function public.booking_contact(bigint) from public, anon;
grant execute on function public.job_contacts(bigint[]) to authenticated;
grant execute on function public.booking_contact(bigint) to authenticated;
