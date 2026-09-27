-- 018: הליפט לא מחכה לבני אדם (28.9).
--
-- ההחלטות של רועי אחרי מעבר על השרשרת:
--   1. הלקוח מאשר בדלפק את הצעת העבודה לטיפול שהוזמן (כולל האבחון). מה שיימצא
--      אחר כך — תוספת, ונשלחת לאישור בנפרד.
--   2. האבחון נעשה על הליפט, לא בעמדה נפרדת לפני שהרכב עולה.
--   3. רכב שמחכה לתשובת לקוח לא תופס ליפט: המכונאי מוריד אותו לחניה, ו**דניאל**
--      מחזיר אותו לתור כשהלקוח אישר. המכונאי מושך מהתור את הבא בתור.
--   4. לקוח שלא ענה 30 דקות מקבל תזכורת. אחרי שעה דניאל רואה "להתקשר".
--   5. ממצא מהמחירון במחיר קבוע ועד 500 ש"ח יוצא ללקוח ישר מהעמדה, בלי דניאל.
--
-- כל השדות חדשים ורשות: הגרסה הקודמת של האתר ממשיכה לעבוד מול המסד הזה.

-- ---------------------------------------------------------------- 1. אישור בדלפק
alter table public.job_cards add column if not exists work_approved_at timestamptz;
alter table public.job_cards add column if not exists work_approved_by uuid references public.staff (id);

-- ---------------------------------------------------------------- 3. איפה הרכב
-- ליפט (lift), או בחוץ (outside_at), או בחניה. בחניה יש שני מצבים: בתור (ברירת
-- המחדל), או "הורד מהליפט" (parked_at) — מחכה למשהו, ומחוץ לתור עד שדניאל מחזיר.
-- priority_at: דניאל החזיר לתור או הקדים. בתור, מי שיש לו priority_at קודם.
alter table public.job_cards add column if not exists parked_at timestamptz;
alter table public.job_cards add column if not exists priority_at timestamptz;
alter table public.job_cards add column if not exists outside_at timestamptz;

create or replace function public.job_cards_place_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
begin
  -- רכב שעלה לליפט כבר לא בחניה, לא בחוץ, ולא צריך קדימות.
  if new.lift is not null and (tg_op = 'INSERT' or old.lift is null) then
    new.parked_at := null;
    new.outside_at := null;
    new.priority_at := null;
  end if;
  -- רכב שסיים (או בוטל) יוצא מכל תור.
  if new.status in ('ready', 'delivered', 'cancelled') then
    new.parked_at := null;
    new.outside_at := null;
    new.priority_at := null;
  end if;

  -- דניאל מחזיר לתור ומקדים — לא המכונאי. RLS נותן למכונאי לעדכן את הכרטיס
  -- (הוא מעלה ומוריד מהליפט), ולכן הכלל נאכף כאן ולא רק בכפתור.
  if tg_op = 'UPDATE' and (select auth.uid()) is not null then
    select s.role into v_role from public.staff s where s.id = (select auth.uid());
    if v_role = 'mechanic' then
      if old.parked_at is not null and new.parked_at is null and new.status not in ('ready', 'delivered', 'cancelled') then
        raise exception 'only the foreman returns a parked car to the queue' using errcode = '42501';
      end if;
      if new.priority_at is distinct from old.priority_at and new.priority_at is not null then
        raise exception 'only the foreman reorders the queue' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists job_cards_place on public.job_cards;
create trigger job_cards_place before insert or update on public.job_cards
  for each row execute function public.job_cards_place_rules();

-- כל תזוזה נרשמת: זה הבסיס למדדים ("כמה זמן רכב עמד על ליפט וחיכה ללקוח"),
-- שעד היום אי אפשר היה לשאול כי נשמר רק המצב של עכשיו (OPEN.md #18).
create table if not exists public.job_moves (
  id bigint generated always as identity primary key,
  job_card_id bigint not null references public.job_cards (id) on delete cascade,
  place text not null check (place in ('lift', 'lot', 'parked', 'outside', 'done')),
  lift smallint,
  status text not null,
  moved_by uuid,
  moved_at timestamptz not null default now()
);
create index if not exists job_moves_job on public.job_moves (job_card_id, moved_at);

alter table public.job_moves enable row level security;
drop policy if exists job_moves_worker_read on public.job_moves;
create policy job_moves_worker_read on public.job_moves for select to authenticated using (public.is_worker());
revoke insert, update, delete on public.job_moves from anon, authenticated;

create or replace function private.log_job_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place text;
begin
  if tg_op = 'UPDATE'
     and new.lift is not distinct from old.lift
     and new.parked_at is not distinct from old.parked_at
     and new.outside_at is not distinct from old.outside_at
     and new.status is not distinct from old.status then
    return null;
  end if;
  v_place := case
    when new.status in ('ready', 'delivered', 'cancelled') then 'done'
    when new.lift is not null then 'lift'
    when new.outside_at is not null then 'outside'
    when new.parked_at is not null then 'parked'
    else 'lot'
  end;
  insert into public.job_moves (job_card_id, place, lift, status, moved_by)
  values (new.id, v_place, new.lift, new.status, (select auth.uid()));
  return null;
end
$$;

drop trigger if exists job_cards_moves on public.job_cards;
create trigger job_cards_moves after insert or update on public.job_cards
  for each row execute function private.log_job_move();

-- ---------------------------------------------------------------- 4. תזכורת ללקוח
alter table public.approvals add column if not exists nudged_at timestamptz;
-- מה שכבר נשלח לפני היום לא מקבל תזכורת: אלה קישורים של בדיקות, לטלפונים אמיתיים.
update public.approvals set nudged_at = now() where nudged_at is null;

alter table public.customer_notices drop constraint if exists customer_notices_kind_check;
alter table public.customer_notices add constraint customer_notices_kind_check
  check (kind in ('ready', 'quote', 'reminder', 'nudge'));

-- נקרא מהאתר, שנקרא מ-pg_cron כל 5 דקות, עם הטוקן המשותף. תופס כל קישור
-- שנשלח לפני 30 דקות ויותר (היום), שלא נענה ולא קיבל תזכורת — פעם אחת.
-- רק בשעות העבודה: הודעה ב-23:00 על מדחס מזגן לא עוזרת לאף אחד.
-- p_at: "מה היה קורה בשעה X". רק למי שמחזיק את הטוקן, ורק כדי שהבדיקה תוכל
-- לבדוק את כלל שעות העבודה בלי לחכות לבוקר (test/lot-queue.mjs).
drop function if exists public.claim_due_nudges(text);
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
    select a.id as approval_id, a.token, j.*
    from public.approvals a
    join public.findings f on f.id = a.finding_id
    join public.job_cards j on j.id = f.job_card_id
    where a.decision is null
      and a.nudged_at is null
      and a.expires_at > v_now
      and a.sent_at < v_now - interval '30 minutes'
      and a.sent_at > v_now - interval '1 day'
      and f.status = 'sent'
    order by a.sent_at
  loop
    update public.approvals set nudged_at = now() where id = r.approval_id;

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

create or replace function public.finish_nudge(p_secret text, p_id bigint, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.bot_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'unknown notice status' using errcode = '22023';
  end if;
  update public.customer_notices
     set status = p_status,
         reason = case when p_status = 'sent' then null else left(p_reason, 40) end,
         sent_at = case when p_status = 'sent' then now() else null end
   where id = p_id and kind = 'nudge' and status = 'pending';
end
$$;

revoke all on function public.claim_due_nudges(text, timestamptz) from public;
revoke all on function public.finish_nudge(text, bigint, text, text) from public;
grant execute on function public.claim_due_nudges(text, timestamptz) to anon, authenticated;
grant execute on function public.finish_nudge(text, bigint, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- 5. מסלול המחירון
-- "מחיר קבוע": אותו מחיר לכל רכב (מגבים, נורה, תקר). חלק שמחירו תלוי בדגם —
-- רפידות, מצבר, צמיג — לא כאן: דניאל בודק מול הספק ומתמחר.
alter table public.price_list add column if not exists fixed_price boolean not null default false;
update public.price_list set fixed_price = true
 where code in ('wipers', 'bulb-head', 'tire-puncture', 'air-filters', 'alignment', 'diag-scan', 'ac-gas');

alter table public.findings add column if not exists direct boolean not null default false;
alter table public.findings drop constraint if exists findings_source_check;
alter table public.findings add constraint findings_source_check
  check (source in ('voice', 'manual', 'intake', 'manager', 'pricelist'));

-- המכונאי בוחר עבודה מהמחירון בעמדה. אם המחיר קבוע ועד 500 ש"ח, והלקוח הסכים
-- לעדכונים — ההצעה יוצאת ללקוח מיד, שלמה לפי החוק (כל השדות מהמחירון).
-- אחרת נפתחת טיוטה מלאה אצל דניאל. בשני המקרים המכונאי לא מקליד מחיר.
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
  v_token text;
  v_direct boolean;
  v_why text;
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

  -- לחיצה כפולה עם כפפה לא פותחת שני ממצאים.
  select id into v_existing from public.findings
   where job_card_id = p_job_id and price_list_id = p_price_list_id and status in ('draft', 'sent', 'approved');
  if v_existing is not null then
    return jsonb_build_object('finding_id', v_existing, 'sent', false, 'why', 'exists');
  end if;

  v_why := case
    when not v_item.fixed_price then 'price_by_model'
    when v_item.price_original > 500 then 'over_500'
    when v_job.updates_consent_at is null and not coalesce(v_job.whatsapp_consent, false) then 'no_consent'
    else null
  end;
  v_direct := v_why is null;

  insert into public.findings (
    job_card_id, source, title, summary, customer_text, urgency, safety,
    price_list_id, price_original, price_aftermarket, labor_hours,
    warranty_original, warranty_aftermarket, part_diff, single_reason,
    created_by, status, direct
  ) values (
    p_job_id, 'pricelist', v_item.title, v_item.title,
    format('במהלך העבודה על הרכב מצאנו שצריך: %s. המחיר לפי המחירון שלנו.', v_item.title),
    'yellow', v_item.safety,
    v_item.id, v_item.price_original, v_item.price_aftermarket, v_item.labor_hours,
    v_item.warranty_original, v_item.warranty_aftermarket, v_item.part_diff, v_item.single_reason,
    (select auth.uid()), 'draft', v_direct
  ) returning id into v_id;

  if not v_direct then
    update public.job_cards set status = 'waiting_quote'
     where id = p_job_id and status in ('open', 'in_progress');
    return jsonb_build_object('finding_id', v_id, 'sent', false, 'why', v_why);
  end if;

  v_token := encode(extensions.gen_random_bytes(18), 'hex');
  insert into public.approvals (finding_id, token, channel, message_text)
  values (v_id, v_token, 'link', (select customer_text from public.findings where id = v_id));
  update public.findings set status = 'sent', sent_at = now(), sent_by = (select auth.uid()) where id = v_id;
  update public.job_cards set status = 'waiting_approval'
   where id = p_job_id and status in ('open', 'in_progress', 'waiting_quote');

  return jsonb_build_object('finding_id', v_id, 'sent', true, 'token', v_token);
end
$$;

revoke all on function public.add_price_list_finding(bigint, bigint) from public;
revoke execute on function public.add_price_list_finding(bigint, bigint) from anon;
grant execute on function public.add_price_list_finding(bigint, bigint) to authenticated;

-- הקישור של ממצא מהמחירון יוצא בוואטסאפ מהעמדה, ולכן מי ששלח אותו (גם מכונאי)
-- רשאי לבקש את ההודעה. כל ממצא אחר — כמו קודם, מנהל עבודה או בעלים בלבד.
create or replace function public.claim_quote_notice(p_finding_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_job public.job_cards%rowtype;
  v_token text;
  v_id bigint;
  v_direct_by_me boolean;
begin
  select s.role into v_role from public.staff s where s.id = (select auth.uid()) and s.active;
  select f.direct and f.sent_by = (select auth.uid()) into v_direct_by_me from public.findings f where f.id = p_finding_id;
  if v_role is null or (v_role not in ('owner', 'manager') and not (v_role = 'mechanic' and coalesce(v_direct_by_me, false))) then
    raise exception 'only a manager or the owner can send a price to a customer' using errcode = '42501';
  end if;

  select a.token into v_token
  from public.approvals a
  join public.findings f on f.id = a.finding_id
  where a.finding_id = p_finding_id
    and f.status = 'sent'
    and a.decision is null
    and a.expires_at > now();
  if v_token is null then
    return null;
  end if;

  select j.* into v_job
  from public.job_cards j
  join public.findings f on f.job_card_id = j.id
  where f.id = p_finding_id;

  insert into public.customer_notices (job_card_id, kind, ref, created_by)
  values (v_job.id, 'quote', v_token, (select auth.uid()))
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
    'id', v_id, 'send', true,
    'phone', v_job.customer_phone, 'name', v_job.customer_name,
    'make', v_job.vehicle_make, 'model', v_job.vehicle_model, 'plate', v_job.plate,
    'token', v_token
  );
end;
$$;
