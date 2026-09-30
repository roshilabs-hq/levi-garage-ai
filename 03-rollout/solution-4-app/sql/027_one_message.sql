-- 027: הודעה אחת ללקוח, ואבחון בלי דריסות (רועי, 30.9, אחרי הסבב השני שלו).
--
-- מה רועי ראה:
--   "כל ממצא שמגיע לדניאל הוא בלוק נפרד. לא שולחים הודעה 5 פעמים. הכל מרוכז."
--   "אם המכונאי מצא ממצא, הוא שולח וואטסאפ ללקוח? ממש לא. הודעה אחת מרוכזת, על ידי דניאל."
--   בנוזלים הוקלט ממצא, ובסוף האבחון נכתב "חסר צילום ודיבור".
--   "נשארו שאריות מסימונים שמחקתי."
--
-- מה משתנה:
--   1. quote_requests: "בקשת אישור" אחת = קישור אחד = הודעה אחת, ובה כמה ממצאים.
--      לכל ממצא עדיין יש שורת approvals משלו (ההכרעה, החלק, המחיר, התמונות),
--      והיא מצביעה על הבקשה. הלקוח מאשר או דוחה כל שורה, בשליחה אחת.
--   2. המכונאי לא שולח כלום. ממצא מהמחירון נכנס לדניאל מתומחר, ומחכה לשליחה.
--   3. תזכורת אחרי 30 דקות: אחת לבקשה, לא אחת לממצא.
--   4. set_inspection_item: פריט באבחון נשמר בפקודה אחת, בלי לקרוא ולכתוב את כל
--      הרשימה. ככה הקלטה של 30 שניות לא נדרסת בידי לחיצה על פריט אחר.
--      צבע שמשתנה לירוק מבטל את הטיוטה שנפתחה מהפריט (אם עוד לא נשלחה).
--   5. "קיה ד." -> "קיה". מאגר משרד התחבורה כותב "קיה ד.קוריאה".

-- ------------------------------------------------------------------ 1. בקשת אישור

create table if not exists public.quote_requests (
  id bigint generated always as identity primary key,
  job_card_id bigint not null references public.job_cards (id) on delete cascade,
  token text not null unique,
  sent_at timestamptz not null default now(),
  sent_by uuid references public.staff (id),
  expires_at timestamptz not null default now() + interval '7 days',
  nudged_at timestamptz,
  decided_at timestamptz
);
create index if not exists quote_requests_job_idx on public.quote_requests (job_card_id);

alter table public.quote_requests enable row level security;
revoke all on public.quote_requests from anon, authenticated;
grant select on public.quote_requests to authenticated;
drop policy if exists quote_requests_read on public.quote_requests;
create policy quote_requests_read on public.quote_requests
  for select to authenticated using (public.is_staff());

alter table public.approvals add column if not exists request_id bigint references public.quote_requests (id) on delete set null;
create index if not exists approvals_request_idx on public.approvals (request_id);

alter table public.quote_versions add column if not exists request_id bigint references public.quote_requests (id) on delete set null;

-- הבדיקות של החוק, במקום אחד: אותן בדיוק כמו ב-send_finding (014).
create or replace function private.check_finding_complete(p_finding_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.findings%rowtype;
begin
  select * into v_f from public.findings where id = p_finding_id;
  if v_f.price_original is null or v_f.labor_hours is null or coalesce(btrim(v_f.warranty_original), '') = '' then
    raise exception 'quote incomplete: price, labor hours and warranty are required'
      using errcode = '22023', hint = 'law-132a', detail = p_finding_id::text;
  end if;
  if v_f.price_aftermarket is null and coalesce(btrim(v_f.single_reason), '') = '' then
    raise exception 'offer more than one part type, or say why there is only one'
      using errcode = '22023', hint = 'law-131', detail = p_finding_id::text;
  end if;
  if v_f.price_aftermarket is not null
     and (coalesce(btrim(v_f.warranty_aftermarket), '') = '' or coalesce(btrim(v_f.part_diff), '') = '') then
    raise exception 'explain the difference between the part types, and the warranty of each'
      using errcode = '22023', hint = 'law-131', detail = p_finding_id::text;
  end if;
  if coalesce(btrim(v_f.customer_text), '') = '' then
    raise exception 'the message to the customer cannot be empty'
      using errcode = '22023', hint = 'message', detail = p_finding_id::text;
  end if;
end;
$$;

/**
 * דניאל שולח ללקוח את הממצאים שבחר, כבקשה אחת. מחזיר את הטוקן של הבקשה.
 * כל ממצא נבדק לפי החוק; אם אחד חסר, לא נשלח כלום (הכול או כלום).
 */
create or replace function public.send_quote_request(p_job_id bigint, p_finding_ids bigint[])
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.my_role();
  v_job public.job_cards%rowtype;
  v_request bigint;
  v_token text;
  v_fid bigint;
  v_count int;
begin
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can send a price to a customer' using errcode = '42501';
  end if;
  if p_finding_ids is null or cardinality(p_finding_ids) = 0 then
    raise exception 'choose at least one finding' using errcode = '22023', hint = 'empty';
  end if;

  select * into v_job from public.job_cards where id = p_job_id for update;
  if not found then
    raise exception 'no such job card' using errcode = 'P0002';
  end if;
  if v_job.updates_consent_at is null and not coalesce(v_job.whatsapp_consent, false) then
    raise exception 'the customer did not agree to electronic updates' using errcode = '22023', hint = 'law-132b';
  end if;

  select count(*) into v_count from public.findings
   where id = any (p_finding_ids) and job_card_id = p_job_id and status = 'draft';
  if v_count <> cardinality(p_finding_ids) then
    raise exception 'every finding must be a draft of this car' using errcode = '22023', hint = 'stale';
  end if;

  foreach v_fid in array p_finding_ids loop
    perform private.check_finding_complete(v_fid);
  end loop;

  v_token := encode(extensions.gen_random_bytes(18), 'hex');
  insert into public.quote_requests (job_card_id, token, sent_by)
  values (p_job_id, v_token, (select auth.uid()))
  returning id into v_request;

  foreach v_fid in array p_finding_ids loop
    insert into public.approvals (finding_id, token, channel, message_text, request_id)
    select v_fid, encode(extensions.gen_random_bytes(18), 'hex'), 'link', btrim(f.customer_text), v_request
      from public.findings f where f.id = v_fid
    on conflict (finding_id) do update
      set token = excluded.token,
          channel = excluded.channel,
          message_text = excluded.message_text,
          request_id = excluded.request_id,
          sent_at = now(),
          decision = null,
          decided_at = null,
          price_chosen = null,
          part_choice = null,
          photo_paths = '{}',
          expires_at = now() + interval '7 days',
          nudged_at = null;
    update public.findings
       set status = 'sent', sent_at = now(), sent_by = (select auth.uid())
     where id = v_fid;
  end loop;

  update public.job_cards
     set status = 'waiting_approval'
   where id = p_job_id and status in ('open', 'in_progress', 'waiting_quote');

  return v_token;
end;
$$;
revoke all on function public.send_quote_request(bigint, bigint[]) from public;
revoke execute on function public.send_quote_request(bigint, bigint[]) from anon;
grant execute on function public.send_quote_request(bigint, bigint[]) to authenticated;

/** דף הלקוח: כל הממצאים של הבקשה. הקישור הוא המפתח; אין כאן שום דבר מעבר לבקשה. */
create or replace function public.request_view(p_token text)
returns table (
  finding_id bigint, message_text text, title text,
  price_original numeric, price_aftermarket numeric, labor_hours numeric,
  warranty_original text, warranty_aftermarket text, part_diff text, single_reason text,
  safety boolean, eta text, photo_paths text[],
  decision text, decided_at timestamptz, part_choice text, price_chosen numeric,
  expired boolean, plate_last3 text, vehicle text,
  list_price_original numeric, list_price_aftermarket numeric, discount_pct numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.id, a.message_text, f.title,
    f.price_original, f.price_aftermarket, f.labor_hours,
    f.warranty_original, f.warranty_aftermarket, f.part_diff, f.single_reason,
    f.safety, f.eta, a.photo_paths,
    a.decision, a.decided_at, a.part_choice, a.price_chosen,
    (now() > r.expires_at) as expired,
    right(j.plate, 3),
    btrim(coalesce(j.vehicle_make, '') || ' ' || coalesce(j.vehicle_model, '')),
    case when f.discount_pct > 0 then f.list_price_original end,
    case when f.discount_pct > 0 then f.list_price_aftermarket end,
    f.discount_pct
  from public.quote_requests r
  join public.approvals a on a.request_id = r.id
  join public.findings f on f.id = a.finding_id
  join public.job_cards j on j.id = r.job_card_id
  where p_token ~ '^[0-9a-f]{36}$' and r.token = p_token
  order by f.safety desc, f.urgency = 'red' desc, f.created_at
$$;
revoke all on function public.request_view(text) from public;
grant execute on function public.request_view(text) to anon, authenticated;

/**
 * ההכרעה של הלקוח, לכל הממצאים בבת אחת.
 * p_decisions: [{"finding_id": 1, "decision": "approved", "part_choice": "original"}, ...]
 * צריך הכרעה לכל ממצא שעוד פתוח בבקשה; אחרת לא נשמר כלום.
 */
create or replace function public.request_decide(p_token text, p_decisions jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.quote_requests%rowtype;
  v_open int;
  v_given int;
  d jsonb;
  v_fid bigint;
  v_dec text;
  v_choice text;
  v_price numeric;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' or jsonb_typeof(p_decisions) <> 'array' then
    return 'unavailable';
  end if;
  select * into v_req from public.quote_requests where token = p_token for update;
  if not found or now() > v_req.expires_at then
    return 'unavailable';
  end if;

  select count(*) into v_open from public.approvals where request_id = v_req.id and decision is null;
  if v_open = 0 then
    return 'unavailable';
  end if;
  select count(distinct (e ->> 'finding_id')) into v_given
    from jsonb_array_elements(p_decisions) e
    join public.approvals a on a.finding_id = (e ->> 'finding_id')::bigint
   where a.request_id = v_req.id and a.decision is null;
  if v_given <> v_open then
    raise exception 'decide every item' using errcode = '22023';
  end if;

  for d in select * from jsonb_array_elements(p_decisions) loop
    v_fid := (d ->> 'finding_id')::bigint;
    v_dec := d ->> 'decision';
    v_choice := d ->> 'part_choice';
    if v_dec not in ('approved', 'declined') then
      raise exception 'decision must be approved or declined' using errcode = '22023';
    end if;
    v_price := null;
    if v_dec = 'approved' then
      if v_choice not in ('original', 'aftermarket') then
        raise exception 'choose an original or an aftermarket part' using errcode = '22023';
      end if;
      select case when v_choice = 'original' then f.price_original else f.price_aftermarket end
        into v_price from public.findings f where f.id = v_fid;
      if v_price is null then
        raise exception 'that part type is not offered' using errcode = '22023';
      end if;
    end if;

    update public.approvals
       set decision = v_dec, decided_at = now(),
           part_choice = case when v_dec = 'approved' then v_choice end,
           price_chosen = v_price
     where finding_id = v_fid and request_id = v_req.id and decision is null;
    update public.findings
       set status = case when v_dec = 'approved' then 'approved' else 'declined' end
     where id = v_fid and status = 'sent';
  end loop;

  update public.quote_requests set decided_at = now() where id = v_req.id;
  update public.job_cards set status = 'in_progress'
   where id = v_req.job_card_id and status = 'waiting_approval'
     and not exists (select 1 from public.findings f where f.job_card_id = v_req.job_card_id and f.status = 'sent');
  return 'done';
end;
$$;
revoke all on function public.request_decide(text, jsonb) from public;
grant execute on function public.request_decide(text, jsonb) to anon, authenticated;

/** הודעת הוואטסאפ של הבקשה: אחת, עם הטוקן של הבקשה. */
create or replace function public.claim_request_notice(p_request_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.my_role();
  v_req public.quote_requests%rowtype;
  v_job public.job_cards%rowtype;
  v_id bigint;
begin
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can send a price to a customer' using errcode = '42501';
  end if;
  select * into v_req from public.quote_requests where id = p_request_id;
  if not found or v_req.decided_at is not null or v_req.expires_at < now() then
    return null;
  end if;
  select * into v_job from public.job_cards where id = v_req.job_card_id;

  insert into public.customer_notices (job_card_id, kind, ref, created_by)
  values (v_job.id, 'quote', v_req.token, (select auth.uid()))
  on conflict (job_card_id, kind, ref) do update
    set status = 'pending', reason = null, sent_at = null, created_at = now(), created_by = excluded.created_by
    where public.customer_notices.status = 'failed'
       or (public.customer_notices.status = 'pending' and public.customer_notices.created_at < now() - interval '2 minutes')
  returning id into v_id;
  if v_id is null then
    return null;
  end if;

  if not coalesce(v_job.whatsapp_consent, false) then
    update public.customer_notices set status = 'skipped', reason = 'no_consent' where id = v_id;
    return jsonb_build_object('id', v_id, 'send', false);
  end if;
  if coalesce(btrim(v_job.customer_phone), '') = '' then
    update public.customer_notices set status = 'skipped', reason = 'no_phone' where id = v_id;
    return jsonb_build_object('id', v_id, 'send', false);
  end if;

  return jsonb_build_object(
    'id', v_id, 'send', true,
    'phone', v_job.customer_phone, 'name', v_job.customer_name,
    'make', v_job.vehicle_make, 'model', v_job.vehicle_model, 'plate', v_job.plate,
    'token', v_req.token
  );
end;
$$;
revoke all on function public.claim_request_notice(bigint) from public;
revoke execute on function public.claim_request_notice(bigint) from anon;
grant execute on function public.claim_request_notice(bigint) to authenticated;

/** המייל המעודכן אחרי ההכרעה: גרסה אחת לבקשה. */
create or replace function public.quote_update_for_request(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.quote_requests%rowtype;
  v_email text;
  v_snapshot jsonb;
  v_version int;
  v_id bigint;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then
    return null;
  end if;
  select * into v_req from public.quote_requests where token = p_token;
  if not found or v_req.decided_at is null or v_req.decided_at < now() - interval '15 minutes' then
    return null;
  end if;
  select customer_email into v_email from public.job_cards where id = v_req.job_card_id;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return null;
  end if;

  perform 1 from public.job_cards where id = v_req.job_card_id for update;
  if exists (select 1 from public.quote_versions where request_id = v_req.id) then
    return null;
  end if;

  v_snapshot := private.quote_snapshot(v_req.job_card_id);
  select coalesce(max(version), 0) + 1 into v_version from public.quote_versions where job_card_id = v_req.job_card_id;
  insert into public.quote_versions (job_card_id, version, reason, channel, request_id, snapshot)
  values (v_req.job_card_id, v_version, 'update', 'email', v_req.id, v_snapshot)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'version', v_version, 'email', v_email, 'snapshot', v_snapshot);
end;
$$;
revoke all on function public.quote_update_for_request(text) from public;
grant execute on function public.quote_update_for_request(text) to anon, authenticated;

create or replace function public.finish_request_update(p_token text, p_id bigint, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  update public.quote_versions v
     set status = p_status,
         sent_at = case when p_status = 'sent' then now() end,
         error = case when p_status = 'failed' then left(p_error, 200) end
    from public.quote_requests r
   where v.id = p_id and v.request_id = r.id and r.token = p_token and v.status = 'pending';
end;
$$;
revoke all on function public.finish_request_update(text, bigint, text, text) from public;
grant execute on function public.finish_request_update(text, bigint, text, text) to anon, authenticated;

/** התמונות של כל ממצא בבקשה: לפי הטוקן של שורת האישור שלו (כמו קודם). */
-- set_approval_photos(p_token, p_paths) נשאר כמו שהוא.

-- ------------------------------------------------------------------ 2. המכונאי לא שולח

create or replace function public.add_price_list_finding(p_job_id bigint, p_price_list_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_job public.job_cards%rowtype;
  v_item public.price_list%rowtype;
  v_existing bigint;
  v_id bigint;
begin
  select s.role into v_role from public.staff s where s.id = (select auth.uid()) and s.active;
  if v_role is null or v_role not in ('owner', 'manager', 'mechanic') then
    raise exception 'only staff can add a finding' using errcode = '42501';
  end if;

  select * into v_job from public.job_cards where id = p_job_id;
  if not found or v_job.status not in ('open', 'in_progress', 'waiting_quote', 'waiting_approval') then
    raise exception 'this car is not in work' using errcode = '22023';
  end if;
  select * into v_item from public.price_list where id = p_price_list_id and active;
  if not found then
    raise exception 'no such price list item' using errcode = 'P0002';
  end if;

  select id into v_existing from public.findings
   where job_card_id = p_job_id and price_list_id = p_price_list_id and status in ('draft', 'sent', 'approved');
  if v_existing is not null then
    return jsonb_build_object('finding_id', v_existing, 'sent', false, 'why', 'exists');
  end if;

  -- מתומחר מהמחירון, ומחכה לדניאל. הוא שולח ללקוח הודעה אחת עם כל הממצאים (027).
  insert into public.findings (
    job_card_id, source, title, summary, customer_text, urgency, safety,
    price_list_id, price_original, price_aftermarket, labor_hours,
    warranty_original, warranty_aftermarket, part_diff, single_reason,
    list_price_original, list_price_aftermarket,
    created_by, status, direct
  ) values (
    p_job_id, 'pricelist', v_item.title, v_item.title,
    format('במהלך העבודה על הרכב מצאנו שצריך: %s. המחיר לפי המחירון שלנו.', v_item.title),
    'yellow', v_item.safety,
    v_item.id, v_item.price_original, v_item.price_aftermarket, v_item.labor_hours,
    v_item.warranty_original, v_item.warranty_aftermarket, v_item.part_diff, v_item.single_reason,
    v_item.price_original, v_item.price_aftermarket,
    (select auth.uid()), 'draft', false
  ) returning id into v_id;

  update public.job_cards set status = 'waiting_quote'
   where id = p_job_id and status in ('open', 'in_progress');
  return jsonb_build_object('finding_id', v_id, 'sent', false, 'why', 'daniel');
end;
$$;

-- ------------------------------------------------------------------ 3. תזכורת אחת לבקשה

create or replace function public.claim_due_nudges(p_secret text, p_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  r record;
  v_id bigint;
  v_now timestamptz := coalesce(p_at, now());
  v_hour int := extract(hour from coalesce(p_at, now()) at time zone 'Asia/Jerusalem');
begin
  if not private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if v_hour < 7 or v_hour >= 19 then
    return v_out;
  end if;

  for r in
    select q.id as request_id, q.token, j.*
    from public.quote_requests q
    join public.job_cards j on j.id = q.job_card_id
    where q.decided_at is null
      and q.nudged_at is null
      and q.expires_at > v_now
      and q.sent_at < v_now - interval '30 minutes'
      and q.sent_at > v_now - interval '1 day'
      and exists (select 1 from public.approvals a where a.request_id = q.id and a.decision is null)
    order by q.sent_at
  loop
    update public.quote_requests set nudged_at = now() where id = r.request_id;
    update public.approvals set nudged_at = now() where request_id = r.request_id;

    v_id := null;
    insert into public.customer_notices (job_card_id, kind, ref)
    values (r.id, 'nudge', r.token)
    on conflict (job_card_id, kind, ref) do nothing
    returning id into v_id;
    continue when v_id is null;

    if not coalesce(r.whatsapp_consent, false) then
      update public.customer_notices set status = 'skipped', reason = 'no_consent' where id = v_id;
      continue;
    end if;
    if coalesce(btrim(r.customer_phone), '') = '' then
      update public.customer_notices set status = 'skipped', reason = 'no_phone' where id = v_id;
      continue;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'send', true,
      'phone', r.customer_phone, 'name', r.customer_name,
      'make', r.vehicle_make, 'model', r.vehicle_model, 'plate', r.plate,
      'token', r.token
    ));
  end loop;
  return v_out;
end
$$;

-- ------------------------------------------------------------------ 4. אבחון בלי דריסות

/**
 * פריט אחד באבחון, בפקודה אחת. p_finding_id: כשהקלטה מהפריט הפכה לממצא.
 * צבע חדש בלי ממצא: אם הפריט עבר לירוק, הטיוטה שנפתחה ממנו מבוטלת (אם לא נשלחה);
 * אם עבר בין צהוב לאדום, הממצא נשאר, והדחיפות מתעדכנת.
 */
create or replace function public.set_inspection_item(p_job_id bigint, p_key text, p_light text, p_finding_id bigint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_old_finding bigint;
  v_new jsonb;
begin
  if not public.is_worker() then
    raise exception 'only staff' using errcode = '42501';
  end if;
  if p_light not in ('green', 'yellow', 'red') or coalesce(p_key, '') !~ '^[a-z_]{2,20}$' then
    raise exception 'bad item' using errcode = '22023';
  end if;

  insert into public.inspections (job_card_id, items, inspector)
  values (p_job_id, '{}'::jsonb, (select auth.uid()))
  on conflict (job_card_id) do nothing;

  select items -> p_key into v_old from public.inspections where job_card_id = p_job_id for update;
  v_old_finding := nullif(v_old ->> 'finding_id', '')::bigint;

  if p_finding_id is not null then
    v_new := jsonb_build_object('light', p_light, 'finding_id', p_finding_id);
  elsif p_light = 'green' then
    if v_old_finding is not null then
      update public.findings set status = 'cancelled' where id = v_old_finding and status = 'draft';
    end if;
    v_new := jsonb_build_object('light', 'green');
  elsif v_old_finding is not null and exists (select 1 from public.findings where id = v_old_finding and status <> 'cancelled') then
    v_new := jsonb_build_object('light', p_light, 'finding_id', v_old_finding);
    if p_light = 'red' then
      update public.findings set urgency = 'red' where id = v_old_finding and status = 'draft';
    end if;
  else
    v_new := jsonb_build_object('light', p_light);
  end if;

  update public.inspections
     set items = coalesce(items, '{}'::jsonb) || jsonb_build_object(p_key, v_new),
         inspector = (select auth.uid())
   where job_card_id = p_job_id;
end;
$$;
revoke all on function public.set_inspection_item(bigint, text, text, bigint) from public;
revoke execute on function public.set_inspection_item(bigint, text, text, bigint) from anon;
grant execute on function public.set_inspection_item(bigint, text, text, bigint) to authenticated;

-- ------------------------------------------------------------------ 5. "קיה ד." -> "קיה"

create or replace function private.clean_make(p_make text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
    coalesce(p_make, ''),
    '(\s+ד\.?\s*קוריאה|\s+(דרום קוריאה|יפן|קוריאה|קוריאה הדרומית|צ''כיה|גרמניה|צרפת|ארה"ב|ארצות הברית|ספרד|איטליה|סין|טורקיה|בריטניה|אנגליה|הודו|תאילנד|רומניה|שבדיה|הונגריה|מקסיקו|סלובקיה|בלגיה|אוסטריה|פולין|פורטוגל|הולנד|קנדה|ברזיל|דרום אפריקה|מרוקו|אינדונזיה|טייוואן|מלזיה|סלובניה|סרביה|רוסיה|ארגנטינה|פינלנד))$',
    ''
  )), '')
$$;

-- מה שכבר נשמר לפני התיקון: "קיה ד." (אחרי שהגרסה הקודמת הורידה רק את "קוריאה").
update public.job_cards set vehicle_make = regexp_replace(vehicle_make, '\s*ד\.$', '') where vehicle_make ~ '\sד\.$';
update public.bookings set vehicle_make = regexp_replace(vehicle_make, '\s*ד\.$', '') where vehicle_make ~ '\sד\.$';
