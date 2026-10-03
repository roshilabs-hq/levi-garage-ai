-- 039: החזרה הגנרלית (3.10). קבלה, הסכמה ורכב בלי תור.
--
-- 1. "בדיקה לפני קנייה" במחירון (450 ש"ח, אושר ע"י רועי). עד היום היא קיבלה
--    בקבלה "אבחון מחשב", כי לא היה לה פריט.
-- 2. הסכמה לעדכונים מתוך הודעת וואטסאפ. הסימון ב-Cal.com הפך לרשות, ולקוח
--    שלא סימן יכול לכתוב לנו "אשמח לקבל עדכונים". ההודעה היא ההסכמה, במילים
--    שלו ומהמספר שלו. הבוט כבר שולח לאתר מזהה אטום של השולח (003 של פתרון 3),
--    ולכן אין כאן שינוי בבוט.
-- 3. "התור נקבע": הדף שואל רק "יש הסכמה?" על התור שנקבע עכשיו, לפי ה-uid
--    ש-Cal.com מוסר לדף. ה-uid לא ניתן לניחוש, והתשובה היא כן/לא בלבד.
-- 4. Make לא דורס: ביטול שמגיע מ-Cal.com לא מבטל רכב שכבר התקבל, ועדכון של
--    התור (שינוי מועד) לא מוחק הסכמה שניתנה בוואטסאפ.
-- 5. רכב בלי תור: דניאל פותח תור מהדלפק, והלקוח מאשר את התקנון בדף ההצעה.

-- 1 ------------------------------------------------------------------------
insert into public.price_list (code, title, category, labor_hours, price_original, price_aftermarket,
  warranty_original, single_reason, safety, active, sort, fixed_price)
select 'pre-purchase', 'בדיקה לפני קנייה', 'service', 1.5, 450, null,
  'ללא', 'עבודה בלבד: בדיקה מורחבת של הרכב, וסיכום מסודר של מה שנמצא, לפני שחותמים על הקנייה.', false, true, 14, true
where not exists (select 1 from public.price_list where code = 'pre-purchase');

-- 2 ------------------------------------------------------------------------
-- מי שכתב לנו "אשמח לקבל עדכונים": התורים הקרובים והכרטיסים הפתוחים שלו.
-- מחזיר כמה שורות השתנו (0 = כבר היה, או שאין לו תור).
create or replace function public.grant_whatsapp_consent(p_secret text, p_client text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_b integer;
  v_j integer;
begin
  select value into v_key from private.settings where key = 'garage_bot_token';
  if v_key is null or p_secret is null or p_secret <> v_key then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_client is null or p_client !~ '^wa-[0-9a-f]{16}$' then
    return 0;
  end if;

  update public.bookings b set whatsapp_consent = true
   where not b.whatsapp_consent
     and b.status in ('booked', 'rescheduled', 'arrived')
     and b.drop_off_at > now() - interval '2 days'
     and private.garage_client_id(b.customer_phone, v_key) = p_client;
  get diagnostics v_b = row_count;

  update public.job_cards j
     set whatsapp_consent = true, updates_consent_at = coalesce(j.updates_consent_at, now())
   where not coalesce(j.whatsapp_consent, false)
     and j.status not in ('delivered', 'cancelled')
     and private.garage_client_id(j.customer_phone, v_key) = p_client;
  get diagnostics v_j = row_count;

  return v_b + v_j;
end;
$$;
revoke all on function public.grant_whatsapp_consent(text, text) from public;
grant execute on function public.grant_whatsapp_consent(text, text) to anon, authenticated;

-- 3 ------------------------------------------------------------------------
create or replace function public.booking_consent(p_uid text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('found', true, 'consent', b.whatsapp_consent)
       from public.bookings b
      where p_uid ~ '^[A-Za-z0-9]{16,40}$' and b.cal_uid = p_uid
        and b.created_at > now() - interval '1 day'),
    jsonb_build_object('found', false));
$$;
revoke all on function public.booking_consent(text) from public;
grant execute on function public.booking_consent(text) to anon, authenticated;

-- 4 ------------------------------------------------------------------------
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

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_email := null;
  end if;

  if v_event = 'BOOKING_CANCELLED' then
    -- רכב שכבר התקבל (גם לפני מועד התור) לא "מתבטל": המקום ביומן מתפנה, הכרטיס נשאר.
    update public.bookings set status = 'cancelled'
     where cal_uid = p->>'cal_uid' and status in ('booked', 'rescheduled')
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'action', case when v_id is null then 'kept' else 'cancelled' end);
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
    status = case when public.bookings.status = 'arrived' then public.bookings.status else excluded.status end,
    drop_off_at = excluded.drop_off_at,
    customer_name = excluded.customer_name,
    customer_phone = excluded.customer_phone,
    customer_email = coalesce(excluded.customer_email, public.bookings.customer_email),
    whatsapp_consent = excluded.whatsapp_consent or public.bookings.whatsapp_consent,
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

-- 5 ------------------------------------------------------------------------
alter table public.bookings add column if not exists source text not null default 'cal';
alter table public.bookings add constraint bookings_source_check check (source in ('cal', 'walkin'));
alter table public.job_cards add column if not exists terms_accepted_at timestamptz;

-- דניאל פותח תור למי שהגיע בלי תור. פרטי הרכב מגיעים מהדלפק (בדיקת לוחית).
create or replace function public.create_walkin_booking(p jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.my_role();
  v_plate text := regexp_replace(coalesce(p->>'plate', ''), '\D', '', 'g');
  v_phone text := regexp_replace(coalesce(p->>'customer_phone', ''), '[^\d+]', '', 'g');
  v_email text := lower(btrim(coalesce(p->>'customer_email', '')));
  v_id bigint;
begin
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can receive a car' using errcode = '42501';
  end if;
  if v_plate !~ '^\d{7,8}$' then
    raise exception 'bad plate' using errcode = '22023', hint = 'plate';
  end if;
  if v_phone !~ '^(\+?972|0)\d{8,9}$' then
    raise exception 'bad phone' using errcode = '22023', hint = 'phone';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_email := null;
  end if;

  insert into public.bookings (
    cal_uid, source, status, drop_off_at, customer_name, customer_phone, customer_email, whatsapp_consent,
    plate, service, notes, vehicle_found, vehicle_make, vehicle_model, vehicle_year, engine_code, fuel, tires, test_valid_until
  ) values (
    -- cal_uid חובה בטבלה (המפתח של Make). לרכב בלי תור: מזהה משלנו, שלעולם לא נשלח ל-Cal.com.
    'walkin-' || replace(gen_random_uuid()::text, '-', ''), 'walkin', 'booked', now(),
    nullif(btrim(coalesce(p->>'customer_name', '')), ''),
    v_phone, v_email, false,
    v_plate,
    nullif(p->>'service', ''),
    nullif(btrim(coalesce(p->>'notes', '')), ''),
    coalesce(nullif(p->>'vehicle_found', '')::boolean, false),
    nullif(p->>'vehicle_make', ''),
    nullif(p->>'vehicle_model', ''),
    nullif(p->>'vehicle_year', '')::int,
    nullif(p->>'engine_code', ''),
    nullif(p->>'fuel', ''),
    nullif(p->>'tires', ''),
    nullif(p->>'test_valid_until', '')::date
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_walkin_booking(jsonb) from public, anon;
grant execute on function public.create_walkin_booking(jsonb) to authenticated;

-- הצעת הקבלה: לקוח שלא עבר בטופס של Cal.com מאשר את התקנון בדף עצמו.
create or replace function public.intake_view(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status',
      case
        when r.decision is not null then r.decision
        when j.work_approved_at is not null then 'signed'
        when now() > r.expires_at then 'expired'
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
  from public.quote_requests r
  join public.job_cards j on j.id = r.job_card_id
  left join public.bookings b on b.id = j.booking_id
  where p_token ~ '^[0-9a-f]{36}$' and r.token = p_token and r.kind = 'intake'
$$;

-- נקרא מהדף רגע לפני האישור, כשהלקוח סימן "קראתי ואני מאשר/ת את התקנון".
create or replace function public.intake_accept_terms(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job bigint;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then
    return 'unavailable';
  end if;
  select job_card_id into v_job from public.quote_requests
   where token = p_token and kind = 'intake' and decided_at is null and now() <= expires_at;
  if v_job is null then
    return 'unavailable';
  end if;
  update public.job_cards set terms_accepted_at = coalesce(terms_accepted_at, now()) where id = v_job;
  return 'done';
end;
$$;
revoke all on function public.intake_accept_terms(text) from public;
grant execute on function public.intake_accept_terms(text) to anon, authenticated;
