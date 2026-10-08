-- 058: קישור לקוח שפג מחזיר רק סטטוס (ביקורת שנייה, 8.10, ממצאים 8 ו-9, שנשארו פתוחים ב-1.18.0).
--
-- 053 רוקנה את התוכן של קישור שפג, אבל השאירה מטא-נתונים:
--   · request_view: שורה לכל ממצא, עם מזהה הממצא. מי שהחזיק קישור ישן ידע כמה פריטים היו ואת המזהים.
--     עכשיו: קישור שפג ולא נענה מחזיר שורה אחת, ריקה, רק עם "פג".
--   · intake_view: קבלה שפגה, ואחר כך הלקוח חתם על עותק מודפס במוסך, חזרה להציג את הרכב, השם
--     והפריטים, כי "נחתם" נחשב תשובה. עכשיו: קבלה שהקישור שלה פג ולא נענה בו מחזירה רק את הסטטוס
--     ("פג", או "נחתם" אם חתם במוסך), בלי פרטים ובלי תאריך.
-- קישור שהלקוח ענה בו, בזמן, נשאר הקבלה שלו, כמו קודם. אותו מבנה החזרה, ולכן create or replace.

create or replace function public.intake_view(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when r.decision is null and coalesce(now() > r.expires_at, false) then
      jsonb_build_object('status', case when j.work_approved_at is not null then 'signed' else 'expired' end,
                         'decided_at', null, 'expires_at', null,
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

create or replace function public.request_view(p_token text)
returns table(finding_id bigint, message_text text, title text, price_original numeric, price_aftermarket numeric, labor_hours numeric, warranty_original text, warranty_aftermarket text, part_diff text, single_reason text, safety boolean, eta text, photo_paths text[], decision text, decided_at timestamp with time zone, part_choice text, price_chosen numeric, expired boolean, plate_last3 text, vehicle text, list_price_original numeric, list_price_aftermarket numeric, discount_pct numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with rows as (
    select f.id, a.message_text, f.title, f.price_original, f.price_aftermarket, f.labor_hours,
           f.warranty_original, f.warranty_aftermarket, f.part_diff, f.single_reason, f.safety, f.eta,
           a.photo_paths, a.decision, a.decided_at, a.part_choice, a.price_chosen,
           coalesce(now() > r.expires_at, false) as expired,
           right(j.plate, 3) as plate_last3,
           btrim(coalesce(j.vehicle_make, '') || ' ' || coalesce(j.vehicle_model, '')) as vehicle,
           case when f.discount_pct > 0 then f.list_price_original end as list_price_original,
           case when f.discount_pct > 0 then f.list_price_aftermarket end as list_price_aftermarket,
           f.discount_pct,
           (coalesce(now() > r.expires_at, false) and a.decision is null) as hide,
           f.urgency, f.created_at
      from public.quote_requests r
      join public.approvals a on a.request_id = r.id
      join public.findings f on f.id = a.finding_id
      join public.job_cards j on j.id = r.job_card_id
     where p_token ~ '^[0-9a-f]{36}$' and r.token = p_token
  )
  select * from (
    -- מה שנענה בזמן: הקבלה של הלקוח, בלי שינוי
    select id, message_text, title, price_original, price_aftermarket, labor_hours, warranty_original,
           warranty_aftermarket, part_diff, single_reason, safety, eta, photo_paths, decision, decided_at,
           part_choice, price_chosen, expired, plate_last3, vehicle, list_price_original, list_price_aftermarket,
           discount_pct
      from rows where not hide
     order by safety desc, urgency = 'red' desc, created_at
  ) visible
  union all
  -- פג ולא נענה: שורה אחת ריקה, רק "פג". בלי מזהים ובלי מספר הפריטים.
  select null::bigint, null, null, null::numeric, null::numeric, null::numeric, null, null, null, null,
         null::boolean, null, null::text[], null, null::timestamptz, null, null::numeric, true, null, null,
         null::numeric, null::numeric, null::numeric
   where exists (select 1 from rows where hide) and not exists (select 1 from rows where not hide)
$$;
