-- 036: אישור דיגיטלי גם להצעה הראשונה, בקבלה (החלטה של רועי, 2.10).
--
-- עד היום ה-V "הלקוח אישר את ההצעה" בקבלת רכב היה הצהרה של דניאל בלבד, בלי שום
-- דבר מהלקוח, וזה בדיוק על הסכום הגדול. עכשיו:
--   * בקבלה יוצא ללקוח קישור לאישור ההצעה (וואטסאפ ומייל) — אותו דף /approve/<token>
--     ואותה הודעת בוט כמו בממצאים, ולכן הבוט לא צריך שינוי.
--   * לקוח בלי סמארטפון חותם על עותק מודפס, ודניאל מסמן "חתם על עותק מודפס".
--   * הרכב נכנס לחניה, אבל לא עולה לליפט עד שההצעה אושרה. הליפט לא מחכה לו
--     (עיקרון 018): התור מדלג עליו, והמסד חוסם העלאה לליפט גם אם עוקפים את המסך.
--
-- חוק: רועי אמר שאין כרגע עורך דין. במסמכים לא לכתוב שהאישור "עומד בחוק", אלא
-- שהוא תיעוד כתוב ומתוארך מהמכשיר של הלקוח.

-- ------------------------------------------------------------------ 1. מבנה

-- איך אושרה העבודה: 'counter' = ה-V של דניאל (כל מה שנקלט לפני היום),
-- 'link' = הלקוח בקישור, 'print' = הלקוח חתם על עותק מודפס.
alter table public.job_cards add column if not exists work_approved_via text
  check (work_approved_via in ('counter', 'link', 'print'));
update public.job_cards set work_approved_via = 'counter'
 where work_approved_at is not null and work_approved_via is null;

-- בקשה מסוג "קבלה": אין בה ממצאים, רק ההצעה הראשונה, וההכרעה היא על כולה.
alter table public.quote_requests add column if not exists kind text not null default 'findings'
  check (kind in ('findings', 'intake'));
alter table public.quote_requests add column if not exists decision text
  check (decision in ('approved', 'declined'));

-- הלוח של דניאל מתעדכן לבד כשלקוח מאשר או דוחה (025).
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'live_tick' and tgrelid = 'public.quote_requests'::regclass
  ) then
    create trigger live_tick after insert or update or delete on public.quote_requests
      for each statement execute function private.tick_live();
  end if;
end
$$;

-- ------------------------------------------------------------------ 2. שליחה (דניאל)

/**
 * בקשת האישור של הקבלה. אם כבר יש אחת פתוחה, מחזיר אותה (שליחה חוזרת = אותו קישור).
 * בלי הסכמה לעדכונים אלקטרוניים אין קישור: הלקוח חותם על עותק מודפס.
 */
create or replace function public.send_intake_request(p_job_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.my_role();
  v_job public.job_cards%rowtype;
  v_token text;
begin
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can send a price to a customer' using errcode = '42501';
  end if;
  select * into v_job from public.job_cards where id = p_job_id for update;
  if not found then
    raise exception 'no such job card' using errcode = 'P0002';
  end if;
  if v_job.work_approved_at is not null then
    raise exception 'the intake quote is already approved' using errcode = '22023', hint = 'approved';
  end if;
  if v_job.updates_consent_at is null and not coalesce(v_job.whatsapp_consent, false) then
    raise exception 'the customer did not agree to electronic updates' using errcode = '22023', hint = 'law-132b';
  end if;

  select token into v_token from public.quote_requests
   where job_card_id = p_job_id and kind = 'intake' and decided_at is null and expires_at > now()
   order by sent_at desc limit 1;
  if v_token is not null then
    return v_token;
  end if;

  v_token := encode(extensions.gen_random_bytes(18), 'hex');
  insert into public.quote_requests (job_card_id, token, sent_by, kind)
  values (p_job_id, v_token, (select auth.uid()), 'intake');
  return v_token;
end;
$$;
revoke all on function public.send_intake_request(bigint) from public, anon;
grant execute on function public.send_intake_request(bigint) to authenticated;

/** לקוח בלי סמארטפון: חתם בדלפק על העותק המודפס. סוגר קישור פתוח, אם יש. */
create or replace function public.mark_intake_signed(p_job_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.my_role();
begin
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can record a signature' using errcode = '42501';
  end if;
  update public.job_cards
     set work_approved_at = now(), work_approved_via = 'print', work_approved_by = (select auth.uid())
   where id = p_job_id and work_approved_at is null;
  if not found then
    return 'already';
  end if;
  update public.quote_requests set expires_at = now()
   where job_card_id = p_job_id and kind = 'intake' and decided_at is null and expires_at > now();
  return 'ok';
end;
$$;
revoke all on function public.mark_intake_signed(bigint) from public, anon;
grant execute on function public.mark_intake_signed(bigint) to authenticated;

-- ------------------------------------------------------------------ 3. הלקוח

/**
 * דף האישור של הקבלה. הקישור הוא המפתח; רק מה שהלקוח צריך כדי להחליט.
 * status: open | approved | declined | expired | signed (חתם על עותק מודפס בינתיים).
 */
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
  where p_token ~ '^[0-9a-f]{36}$' and r.token = p_token and r.kind = 'intake'
$$;
revoke all on function public.intake_view(text) from public;
grant execute on function public.intake_view(text) to anon, authenticated;

/** ההכרעה של הלקוח על ההצעה כולה. 'done' או 'unavailable' (פג, כבר הוכרע, או חתם בינתיים). */
create or replace function public.intake_decide(p_token text, p_decision text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.quote_requests%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' or p_decision not in ('approved', 'declined') then
    return 'unavailable';
  end if;
  select * into v_req from public.quote_requests
   where token = p_token and kind = 'intake' for update;
  if not found or v_req.decided_at is not null or now() > v_req.expires_at then
    return 'unavailable';
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
revoke all on function public.intake_decide(text, text) from public;
grant execute on function public.intake_decide(text, text) to anon, authenticated;

-- ------------------------------------------------------------------ 4. השער: בלי אישור, לא לליפט

create or replace function private.lift_needs_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lift is not null and (tg_op = 'INSERT' or old.lift is null) and new.work_approved_at is null then
    raise exception 'the customer has not approved the intake quote yet'
      using errcode = '42501', hint = 'intake';
  end if;
  return new;
end
$$;

create trigger job_cards_lift_needs_approval before insert or update of lift on public.job_cards
  for each row execute function private.lift_needs_approval();
