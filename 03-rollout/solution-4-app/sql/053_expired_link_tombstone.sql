-- 053: קישור לקוח שפג לפני שהלקוח ענה לא מציג יותר את ההצעה (ביקורת אבטחה חיצונית, 7.10, ממצא 5).
--
-- עד היום הטוקן "פג" רק לכתיבה: אחרי שבוע אי אפשר היה להחליט, והתמונות לא נחתמו, אבל מי שהחזיק
-- בקישור המשיך לראות את שם הלקוח, הרכב, הפריטים והמחירים, בלי הגבלת זמן.
--
-- מעכשיו:
--   · פג ולא נענה: רק הסטטוס. בלי שם, רכב, פריטים, מחירים או הודעה. הדף מציג "הקישור פג".
--   · נענה (אישר, דחה, או חתם על עותק): הקבלה נשארת. זה התיעוד של הלקוח למה שאישר ובכמה,
--     כמו שמדיניות הפרטיות מתארת (הצעות ואישורים נשמרים שנה).
-- אותו מבנה החזרה כמו קודם, כדי שהדף לא ישתנה. רק הערכים מתרוקנים.

-- ---------------------------------------------------------------- הצעת הקבלה
create or replace function public.intake_view(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when r.decision is null and j.work_approved_at is null and coalesce(now() > r.expires_at, false) then
      jsonb_build_object('status', 'expired', 'decided_at', null, 'expires_at', r.expires_at,
                         'plate_last3', null, 'vehicle', null, 'customer', null, 'needs_terms', false,
                         'lines', '[]'::jsonb)
    else jsonb_build_object(
      'status',
        case
          when r.decision is not null then r.decision
          when j.work_approved_at is not null then 'signed'
          else 'open'
        end,
      'decided_at', coalesce(r.decided_at, j.work_approved_at),
      'expires_at', r.expires_at,
      'plate_last3', right(j.plate, 3),
      'vehicle', btrim(coalesce(j.vehicle_make, '') || ' ' || coalesce(j.vehicle_model, '')),
      'customer', split_part(btrim(coalesce(j.customer_name, '')), ' ', 1),
      'needs_terms', coalesce(b.source = 'walkin', false) and j.terms_accepted_at is null,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'title', q.title,
                 'labor_hours', q.labor_hours,
                 'part_choice', q.part_choice,
                 'price_original', q.price_original,
                 'price_aftermarket', q.price_aftermarket,
                 'warranty', case when q.part_choice = 'aftermarket' then q.warranty_aftermarket else q.warranty_original end,
                 'part_diff', q.part_diff,
                 'single_reason', q.single_reason,
                 'price', case when q.part_choice = 'aftermarket' then q.price_aftermarket else q.price_original end
               ) order by q.created_at)
          from public.quote_items q where q.job_card_id = j.id
      ), '[]'::jsonb)
    )
  end
  from public.quote_requests r
  join public.job_cards j on j.id = r.job_card_id
  left join public.bookings b on b.id = j.booking_id
  where p_token ~ '^[0-9a-f]{36}$' and r.token = p_token and r.kind = 'intake'
$$;

-- ---------------------------------------------------------------- ממצאים לאישור (הודעה אחת)
-- שורה שעוד לא נענתה, בקישור שפג: רק המזהה והסימון שפג. שורה שנענתה נשארת כמו שהיא.
create or replace function public.request_view(p_token text)
returns table(finding_id bigint, message_text text, title text, price_original numeric, price_aftermarket numeric, labor_hours numeric, warranty_original text, warranty_aftermarket text, part_diff text, single_reason text, safety boolean, eta text, photo_paths text[], decision text, decided_at timestamp with time zone, part_choice text, price_chosen numeric, expired boolean, plate_last3 text, vehicle text, list_price_original numeric, list_price_aftermarket numeric, discount_pct numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.id,
    case when x.hide then null else a.message_text end,
    case when x.hide then null else f.title end,
    case when x.hide then null else f.price_original end,
    case when x.hide then null else f.price_aftermarket end,
    case when x.hide then null else f.labor_hours end,
    case when x.hide then null else f.warranty_original end,
    case when x.hide then null else f.warranty_aftermarket end,
    case when x.hide then null else f.part_diff end,
    case when x.hide then null else f.single_reason end,
    case when x.hide then null else f.safety end,
    case when x.hide then null else f.eta end,
    case when x.hide then null else a.photo_paths end,
    a.decision, a.decided_at,
    case when x.hide then null else a.part_choice end,
    case when x.hide then null else a.price_chosen end,
    (now() > r.expires_at) as expired,
    case when x.hide then null else right(j.plate, 3) end,
    case when x.hide then null else btrim(coalesce(j.vehicle_make, '') || ' ' || coalesce(j.vehicle_model, '')) end,
    case when not x.hide and f.discount_pct > 0 then f.list_price_original end,
    case when not x.hide and f.discount_pct > 0 then f.list_price_aftermarket end,
    case when x.hide then null else f.discount_pct end
  from public.quote_requests r
  join public.approvals a on a.request_id = r.id
  join public.findings f on f.id = a.finding_id
  join public.job_cards j on j.id = r.job_card_id
  cross join lateral (select (coalesce(now() > r.expires_at, false) and a.decision is null) as hide) x
  where p_token ~ '^[0-9a-f]{36}$' and r.token = p_token
  order by f.safety desc, f.urgency = 'red' desc, f.created_at
$$;

-- מה כבר אושר קודם: רק בקישור שעוד בתוקף, או שהלקוח כבר ענה בו.
create or replace function public.request_agreed(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select id, job_card_id from public.quote_requests
     where p_token ~ '^[0-9a-f]{36}$' and token = p_token
       and (expires_at is null or now() <= expires_at or decided_at is not null)
  )
  select jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('title', l ->> 'title', 'price', (l ->> 'price')::numeric))
        from jsonb_array_elements(private.quote_snapshot(r.job_card_id) -> 'lines') l
    ), '[]'::jsonb),
    'approved', coalesce((
      select jsonb_agg(jsonb_build_object('title', coalesce(f.title, f.summary), 'price', a.price_chosen) order by a.decided_at)
        from public.findings f
        join public.approvals a on a.finding_id = f.id and a.decision = 'approved'
       where f.job_card_id = r.job_card_id and f.status = 'approved' and a.request_id is distinct from r.id
    ), '[]'::jsonb)
  )
  from r
$$;

-- ---------------------------------------------------------------- ממצא בודד (הקישור הישן, לפני 027)
create or replace function public.approval_view(p_token text)
returns table(message_text text, title text, price_original numeric, price_aftermarket numeric, labor_hours numeric, warranty_original text, warranty_aftermarket text, part_diff text, single_reason text, safety boolean, eta text, photo_paths text[], decision text, decided_at timestamp with time zone, part_choice text, expired boolean, plate_last3 text, vehicle text, list_price_original numeric, list_price_aftermarket numeric, discount_pct numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when x.hide then null else a.message_text end,
    case when x.hide then null else f.title end,
    case when x.hide then null else f.price_original end,
    case when x.hide then null else f.price_aftermarket end,
    case when x.hide then null else f.labor_hours end,
    case when x.hide then null else f.warranty_original end,
    case when x.hide then null else f.warranty_aftermarket end,
    case when x.hide then null else f.part_diff end,
    case when x.hide then null else f.single_reason end,
    case when x.hide then null else f.safety end,
    case when x.hide then null else f.eta end,
    case when x.hide then null else a.photo_paths end,
    a.decision, a.decided_at,
    case when x.hide then null else a.part_choice end,
    (now() > a.expires_at) as expired,
    case when x.hide then null else right(j.plate, 3) end,
    case when x.hide then null else btrim(coalesce(j.vehicle_make, '') || ' ' || coalesce(j.vehicle_model, '')) end,
    case when not x.hide and f.discount_pct > 0 then f.list_price_original end,
    case when not x.hide and f.discount_pct > 0 then f.list_price_aftermarket end,
    case when x.hide then null else f.discount_pct end
  from public.approvals a
  join public.findings f on f.id = a.finding_id
  join public.job_cards j on j.id = f.job_card_id
  cross join lateral (select (coalesce(now() > a.expires_at, false) and a.decision is null) as hide) x
  where a.token = p_token
$$;
