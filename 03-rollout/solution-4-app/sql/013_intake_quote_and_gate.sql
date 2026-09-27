-- קבלת רכב עד "מוכן", בגרסה שעומדת בחוק ומורידה מהמכונאי כל מה שאינו לכידה (27.9).
--
-- מבוסס על המחקר ב-reports/ (לא בגיט) ועל ההחלטות של רועי:
--   1. כל רכב עובר בדיקת כניסה סטנדרטית בעמדת האבחון (inspections).
--   2. מחירון במערכת (price_list): דניאל בוחר עבודה, והשדות מתמלאים.
--   3. הצעת מחיר ראשונה במייל, ועדכון שלה אחרי כל אישור (quote_versions).
--   4. דניאל הוא המנהל המקצועי, ואבי המגבה שלו.
--
-- החוק (רישוי שירותים ומקצועות בענף הרכב, התשע"ו-2016, ותקנות המוסכים 2022):
--   ס' 131     — להציע יותר מסוג חלק אחד ולהסביר את ההבדל, לפני הצעת המחיר.
--   ס' 132(א)  — בהצעה: הפעולות, שעות העבודה הצפויות, סוגי החלקים, היקף האחריות, התשלום.
--   ס' 132(ב)  — הצעה ראשונה במסמך מודפס או במייל. עדכון באמצעי אלקטרוני רק בהסכמת
--                הלקוח, ואז לעדכן בהקדם את ההצעה הראשונה.
--   ס' 132(ג-ה)— לשמור הצעות ועדכונים שנה.
--   תקנה 8     — לא לבצע עבודה שלא בהצעה (ראשונה או מעודכנת).
--   תקנה 6     — ליקוי בטיחותי שלא תוקן: לדווח לרשות הרישוי תוך יום עבודה מהמסירה.
-- מה שהחוק דורש נאכף כאן, במסד, ולא רק במסך: send_finding מסרבת לשלוח הצעה חסרה.

-- ---------------------------------------------------------------- המחירון
create table if not exists public.price_list (
  id bigint generated always as identity primary key,
  code text not null unique,
  title text not null,
  category text not null,
  labor_hours numeric(4, 2) not null check (labor_hours >= 0),
  -- מחיר סופי ללקוח, כולל חלקים, עבודה ומע"מ, לכל סוג חלק
  price_original numeric(10, 2) not null check (price_original >= 0),
  price_aftermarket numeric(10, 2) check (price_aftermarket >= 0),
  warranty_original text not null,
  warranty_aftermarket text,
  part_diff text,          -- ההסבר ללקוח על ההבדל בין הסוגים (ס' 131)
  single_reason text,      -- למה אין חלופה, כשאין (ס' 131: "במאמץ סביר")
  safety boolean not null default false,  -- בלמים, היגוי, צמיגים (תקנה 6)
  active boolean not null default true,
  sort int not null default 100,
  constraint price_list_two_or_why check (price_aftermarket is not null or single_reason is not null),
  constraint price_list_diff_when_two check (
    price_aftermarket is null or (warranty_aftermarket is not null and part_diff is not null)
  )
);

alter table public.price_list enable row level security;
drop policy if exists price_list_read on public.price_list;
create policy price_list_read on public.price_list
  for select to authenticated using (public.is_worker());
drop policy if exists price_list_write on public.price_list;
create policy price_list_write on public.price_list
  for all to authenticated
  using (public.my_role() in ('owner', 'manager'))
  with check (public.my_role() in ('owner', 'manager'));

-- ---------------------------------------------------------------- כרטיס העבודה
alter table public.job_cards add column if not exists customer_email text;
alter table public.job_cards add column if not exists odometer_km int check (odometer_km >= 0);
-- ההסכמה לקבל עדכוני הצעת מחיר באמצעי אלקטרוני (ס' 132(ב)), עם שעה
alter table public.job_cards add column if not exists updates_consent_at timestamptz;
alter table public.job_cards add column if not exists inspected_at timestamptz;
alter table public.job_cards add column if not exists inspected_by uuid references public.staff (id);

-- ---------------------------------------------------------------- הצעת המחיר הראשונה
-- שורות שסוכמו בדלפק בקבלה: השירות שהוזמן, עם סוג החלק שהלקוח בחר.
create table if not exists public.quote_items (
  id bigint generated always as identity primary key,
  job_card_id bigint not null references public.job_cards (id) on delete cascade,
  price_list_id bigint references public.price_list (id),
  title text not null,
  labor_hours numeric(4, 2) not null,
  price_original numeric(10, 2) not null,
  price_aftermarket numeric(10, 2),
  warranty_original text not null,
  warranty_aftermarket text,
  part_diff text,
  single_reason text,
  part_choice text not null check (part_choice in ('original', 'aftermarket')),
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  constraint quote_items_two_or_why check (price_aftermarket is not null or single_reason is not null),
  constraint quote_items_diff_when_two check (
    price_aftermarket is null or (warranty_aftermarket is not null and part_diff is not null)
  ),
  constraint quote_items_choice_exists check (part_choice = 'original' or price_aftermarket is not null)
);

alter table public.quote_items enable row level security;
drop policy if exists quote_items_read on public.quote_items;
create policy quote_items_read on public.quote_items
  for select to authenticated using (public.is_worker());
drop policy if exists quote_items_write on public.quote_items;
create policy quote_items_write on public.quote_items
  for all to authenticated
  using (public.my_role() in ('owner', 'manager'))
  with check (public.my_role() in ('owner', 'manager'));

-- כל גרסה של ההצעה שיצאה ללקוח, כפי שיצאה (ס' 132(ג-ה): לשמור שנה).
-- snapshot הוא מה שהלקוח קיבל, מילה במילה ומספר במספר — לא שחזור מאוחר.
create table if not exists public.quote_versions (
  id bigint generated always as identity primary key,
  job_card_id bigint not null references public.job_cards (id) on delete cascade,
  version int not null,
  reason text not null check (reason in ('intake', 'update')),
  channel text not null check (channel in ('email', 'print')),
  approval_id bigint unique references public.approvals (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  snapshot jsonb not null,
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (job_card_id, version)
);

alter table public.quote_versions enable row level security;
drop policy if exists quote_versions_read on public.quote_versions;
create policy quote_versions_read on public.quote_versions
  for select to authenticated using (public.my_role() in ('owner', 'manager'));
-- כתיבה רק דרך הפונקציות למטה.

-- ---------------------------------------------------------------- בדיקת הכניסה
create table if not exists public.inspections (
  job_card_id bigint primary key references public.job_cards (id) on delete cascade,
  -- key של פריט -> { light: green|yellow|red, finding_id }
  items jsonb not null default '{}'::jsonb,
  inspector uuid references public.staff (id),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.inspections enable row level security;
drop policy if exists inspections_read on public.inspections;
create policy inspections_read on public.inspections
  for select to authenticated using (public.is_staff());
drop policy if exists inspections_write on public.inspections;
create policy inspections_write on public.inspections
  for all to authenticated using (public.is_worker()) with check (public.is_worker());

-- ---------------------------------------------------------------- "דניאל, בוא לעמדה"
create table if not exists public.help_calls (
  id bigint generated always as identity primary key,
  job_card_id bigint references public.job_cards (id) on delete cascade,
  lift smallint,
  requested_by uuid not null references public.staff (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.staff (id)
);

alter table public.help_calls enable row level security;
drop policy if exists help_calls_read on public.help_calls;
create policy help_calls_read on public.help_calls
  for select to authenticated using (public.is_worker());
drop policy if exists help_calls_create on public.help_calls;
create policy help_calls_create on public.help_calls
  for insert to authenticated
  with check (public.is_worker() and requested_by = (select auth.uid()) and resolved_at is null);
drop policy if exists help_calls_resolve on public.help_calls;
create policy help_calls_resolve on public.help_calls
  for update to authenticated
  using (public.my_role() in ('owner', 'manager'))
  with check (public.my_role() in ('owner', 'manager'));

-- ---------------------------------------------------------------- הממצא
alter table public.findings drop constraint if exists findings_source_check;
alter table public.findings add constraint findings_source_check
  check (source in ('voice', 'manual', 'intake', 'manager'));
alter table public.findings add column if not exists title text;
alter table public.findings add column if not exists urgency text check (urgency in ('red', 'yellow'));
alter table public.findings add column if not exists safety boolean not null default false;
alter table public.findings add column if not exists price_list_id bigint references public.price_list (id);
alter table public.findings add column if not exists labor_hours numeric(4, 2);
alter table public.findings add column if not exists warranty_original text;
alter table public.findings add column if not exists warranty_aftermarket text;
alter table public.findings add column if not exists part_diff text;
alter table public.findings add column if not exists single_reason text;
alter table public.findings add column if not exists safety_reported_at timestamptz;
alter table public.findings add column if not exists safety_reported_by uuid references public.staff (id);

-- התמונות שהלקוח רואה בדף האישור. הדלי של הכרטיסים פרטי, ולקוח לא מחובר;
-- לכן ברגע השליחה התמונות של הממצא מועתקות לדלי ציבורי, בנתיב עם הטוקן
-- (אקראי, 36 תווים) — אותה רמת סודיות כמו הקישור עצמו.
alter table public.approvals add column if not exists photo_paths text[] not null default '{}';

-- ---------------------------------------------------------------- תמונת ההצעה
-- מקור אחד להצעה: אותו מבנה נשלח במייל, מודפס בדלפק ונשמר בגרסאות.
create or replace function private.quote_snapshot(p_job_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'job', jsonb_build_object(
      'id', j.id,
      'plate', j.plate,
      'vehicle', nullif(btrim(concat_ws(' ', j.vehicle_make, j.vehicle_model)), ''),
      'year', j.vehicle_year,
      'customer', j.customer_name,
      'odometer_km', j.odometer_km,
      'opened_at', j.opened_at
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', q.title,
               'labor_hours', q.labor_hours,
               'price_original', q.price_original,
               'price_aftermarket', q.price_aftermarket,
               'warranty_original', q.warranty_original,
               'warranty_aftermarket', q.warranty_aftermarket,
               'part_diff', q.part_diff,
               'single_reason', q.single_reason,
               'part_choice', q.part_choice,
               'price', case when q.part_choice = 'aftermarket' then q.price_aftermarket else q.price_original end
             ) order by q.created_at)
      from public.quote_items q where q.job_card_id = j.id
    ), '[]'::jsonb),
    'findings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id,
               'title', coalesce(f.title, f.summary),
               'text', coalesce(a.message_text, f.customer_text),
               'status', f.status,
               'safety', f.safety,
               'labor_hours', f.labor_hours,
               'price_original', f.price_original,
               'price_aftermarket', f.price_aftermarket,
               'warranty_original', f.warranty_original,
               'warranty_aftermarket', f.warranty_aftermarket,
               'part_diff', f.part_diff,
               'single_reason', f.single_reason,
               'part_choice', a.part_choice,
               'price', a.price_chosen,
               'decided_at', a.decided_at
             ) order by f.created_at)
      from public.findings f
      left join public.approvals a on a.finding_id = f.id
      where f.job_card_id = j.id and f.status in ('sent', 'approved', 'declined')
    ), '[]'::jsonb)
  )
  from public.job_cards j
  where j.id = p_job_id
$$;

revoke all on function private.quote_snapshot(bigint) from public;

-- לצוות: תצוגת ההצעה (הדף המודפס). כל עובד רואה, כמו את הכרטיס עצמו.
create or replace function public.quote_snapshot(p_job_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_worker() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  return private.quote_snapshot(p_job_id);
end;
$$;

revoke all on function public.quote_snapshot(bigint) from public;
revoke execute on function public.quote_snapshot(bigint) from anon;
grant execute on function public.quote_snapshot(bigint) to authenticated;

-- מנהל עבודה או הבעלים פותחים גרסה (הצעה ראשונה בקבלה, או מודפסת).
create or replace function public.start_quote_version(p_job_id bigint, p_reason text, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.my_role();
  v_snapshot jsonb;
  v_version int;
  v_id bigint;
begin
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can issue a quote' using errcode = '42501';
  end if;
  if p_reason not in ('intake', 'update') or p_channel not in ('email', 'print') then
    raise exception 'unknown reason or channel' using errcode = '22023';
  end if;

  v_snapshot := private.quote_snapshot(p_job_id);
  if v_snapshot is null then
    raise exception 'no such job card' using errcode = 'P0002';
  end if;
  if jsonb_array_length(v_snapshot -> 'lines') = 0 and jsonb_array_length(v_snapshot -> 'findings') = 0 then
    raise exception 'the quote is empty' using errcode = '22023';
  end if;

  perform 1 from public.job_cards where id = p_job_id for update;
  select coalesce(max(version), 0) + 1 into v_version from public.quote_versions where job_card_id = p_job_id;

  insert into public.quote_versions (job_card_id, version, reason, channel, snapshot, created_by,
                                     status, sent_at)
  values (p_job_id, v_version, p_reason, p_channel, v_snapshot, (select auth.uid()),
          case when p_channel = 'print' then 'sent' else 'pending' end,
          case when p_channel = 'print' then now() end)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'version', v_version,
    'email', (select customer_email from public.job_cards where id = p_job_id),
    'snapshot', v_snapshot
  );
end;
$$;

revoke all on function public.start_quote_version(bigint, text, text) from public;
revoke execute on function public.start_quote_version(bigint, text, text) from anon;
grant execute on function public.start_quote_version(bigint, text, text) to authenticated;

create or replace function public.finish_quote_version(p_id bigint, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    raise exception 'only a manager or the owner' using errcode = '42501';
  end if;
  if p_status not in ('sent', 'failed') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  update public.quote_versions
     set status = p_status,
         error = case when p_status = 'failed' then left(p_error, 300) end,
         sent_at = case when p_status = 'sent' then now() end
   where id = p_id and status = 'pending';
end;
$$;

revoke all on function public.finish_quote_version(bigint, text, text) from public;
revoke execute on function public.finish_quote_version(bigint, text, text) from anon;
grant execute on function public.finish_quote_version(bigint, text, text) to authenticated;

-- הלקוח ענה בקישור: ההצעה הראשונה מתעדכנת (ס' 132(ב) "בהקדם האפשרי").
-- הלקוח לא מחובר, ולכן זו "דלת צרה" לפי הטוקן: רק אחרי הכרעה, רק פעם אחת
-- לכל אישור, ורק עם המייל שלו עצמו.
create or replace function public.quote_update_for_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.approvals%rowtype;
  v_job bigint;
  v_email text;
  v_snapshot jsonb;
  v_version int;
  v_id bigint;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then
    return null;
  end if;

  select * into v_approval from public.approvals where token = p_token;
  if not found or v_approval.decision is null or v_approval.decided_at < now() - interval '15 minutes' then
    return null;
  end if;

  select f.job_card_id into v_job from public.findings f where f.id = v_approval.finding_id;
  select customer_email into v_email from public.job_cards where id = v_job;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return null;
  end if;

  perform 1 from public.job_cards where id = v_job for update;
  if exists (select 1 from public.quote_versions where approval_id = v_approval.id) then
    return null;
  end if;

  v_snapshot := private.quote_snapshot(v_job);
  select coalesce(max(version), 0) + 1 into v_version from public.quote_versions where job_card_id = v_job;
  insert into public.quote_versions (job_card_id, version, reason, channel, approval_id, snapshot)
  values (v_job, v_version, 'update', 'email', v_approval.id, v_snapshot)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'version', v_version, 'email', v_email, 'snapshot', v_snapshot);
end;
$$;

revoke all on function public.quote_update_for_token(text) from public;
grant execute on function public.quote_update_for_token(text) to anon, authenticated;

create or replace function public.finish_quote_update(p_token text, p_id bigint, p_status text, p_error text default null)
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
         error = case when p_status = 'failed' then left(p_error, 300) end,
         sent_at = case when p_status = 'sent' then now() end
   where v.id = p_id
     and v.status = 'pending'
     and v.approval_id = (select a.id from public.approvals a where a.token = p_token);
end;
$$;

revoke all on function public.finish_quote_update(text, bigint, text, text) from public;
grant execute on function public.finish_quote_update(text, bigint, text, text) to anon, authenticated;

-- התמונות לדף הלקוח נרשמות אחרי שהועתקו (השרת מעתיק, המסד רק זוכר איפה).
create or replace function public.set_approval_photos(p_token text, p_paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    raise exception 'only a manager or the owner' using errcode = '42501';
  end if;
  update public.approvals
     set photo_paths = coalesce(p_paths[1:6], '{}')
   where token = p_token and decision is null;
end;
$$;

revoke all on function public.set_approval_photos(text, text[]) from public;
revoke execute on function public.set_approval_photos(text, text[]) from anon;
grant execute on function public.set_approval_photos(text, text[]) to authenticated;

-- ---------------------------------------------------------------- מה הלקוח רואה
-- הצורה משתנה (שדות חדשים), ולכן drop ו-create, והרשאות מחדש.
drop function if exists public.approval_view(text);
create function public.approval_view(p_token text)
returns table (
  message_text text,
  title text,
  price_original numeric,
  price_aftermarket numeric,
  labor_hours numeric,
  warranty_original text,
  warranty_aftermarket text,
  part_diff text,
  single_reason text,
  safety boolean,
  eta text,
  photo_paths text[],
  decision text,
  decided_at timestamptz,
  part_choice text,
  expired boolean,
  plate_last3 text,
  vehicle text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.message_text,
    f.title,
    f.price_original,
    f.price_aftermarket,
    f.labor_hours,
    f.warranty_original,
    f.warranty_aftermarket,
    f.part_diff,
    f.single_reason,
    f.safety,
    f.eta,
    a.photo_paths,
    a.decision,
    a.decided_at,
    a.part_choice,
    (now() > a.expires_at) as expired,
    right(j.plate, 3) as plate_last3,
    btrim(coalesce(j.vehicle_make, '') || ' ' || coalesce(j.vehicle_model, '')) as vehicle
  from public.approvals a
  join public.findings f on f.id = a.finding_id
  join public.job_cards j on j.id = f.job_card_id
  where a.token = p_token
$$;

revoke all on function public.approval_view(text) from public;
grant execute on function public.approval_view(text) to anon, authenticated;

-- ---------------------------------------------------------------- דלי התמונות ללקוח
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shared-quotes', 'shared-quotes', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists shared_quotes_manager_write on storage.objects;
create policy shared_quotes_manager_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'shared-quotes' and public.my_role() in ('owner', 'manager'));

-- ---------------------------------------------------------------- המחירון להדגמה
-- מחירים סבירים למוסך עצמאי בקריות, 2026, כולל מע"מ. בדויים: זה עסק בדוי.
insert into public.price_list
  (code, title, category, labor_hours, price_original, price_aftermarket, warranty_original, warranty_aftermarket, part_diff, single_reason, safety, sort)
values
  ('service-small', 'טיפול תקופתי קטן: שמן ומסנן שמן', 'service', 1.0, 650, 450,
   '6 חודשים או 10,000 ק"מ', '6 חודשים או 10,000 ק"מ',
   'מקורי: שמן ומסנן של יצרן הרכב. חלופי: שמן באותו תקן שהיצרן דורש, ומסנן של יצרן מוכר. שניהם עומדים בדרישות היצרן.', null, false, 10),
  ('service-big', 'טיפול תקופתי גדול: שמן, מסננים ובדיקות', 'service', 2.5, 1650, 1200,
   '12 חודשים או 15,000 ק"מ', '12 חודשים או 15,000 ק"מ',
   'מקורי: חלקים של יצרן הרכב. חלופי: חלקים של יצרנים מוכרים באותו תקן. ההבדל העיקרי במחיר, לא בביצועים.', null, false, 11),
  ('test-prep', 'הכנה וליווי לטסט', 'service', 1.5, 350, null,
   'ללא', null, null, 'עבודה בלבד. חלקים, אם יידרשו, בהצעה נפרדת לפי מה שיימצא.', false, 12),
  ('diag-scan', 'אבחון מחשב (סריקת תקלות)', 'electric', 0.5, 250, null,
   'ללא', null, null, 'עבודה בלבד, בלי חלקים.', false, 13),
  ('brakes-front-pads', 'החלפת רפידות בלם קדמיות', 'brakes', 1.0, 780, 520,
   '12 חודשים או 20,000 ק"מ', '6 חודשים או 10,000 ק"מ',
   'מקורי: רפידות של יצרן הרכב, שקטות ועם מעט אבק. חלופי: יצרן מוכר בתקן אירופי, ייתכן קצת יותר אבק על החישוקים.', null, true, 20),
  ('brakes-front-discs', 'החלפת רפידות ודיסקים קדמיים', 'brakes', 2.0, 1850, 1250,
   '12 חודשים או 20,000 ק"מ', '6 חודשים או 10,000 ק"מ',
   'מקורי: דיסקים ורפידות של יצרן הרכב. חלופי: יצרן מוכר בתקן אירופי. שניהם בטוחים; המקורי מחזיק בדרך כלל יותר זמן.', null, true, 21),
  ('brakes-rear-pads', 'החלפת רפידות בלם אחוריות', 'brakes', 1.0, 720, 480,
   '12 חודשים או 20,000 ק"מ', '6 חודשים או 10,000 ק"מ',
   'מקורי: רפידות של יצרן הרכב. חלופי: יצרן מוכר בתקן אירופי.', null, true, 22),
  ('tire-one', 'החלפת צמיג (אחד)', 'tires', 0.3, 650, 420,
   'אחריות יצרן הצמיג', 'אחריות יצרן הצמיג',
   'מקורי: אותו דגם שהגיע מהמפעל. חלופי: מותג אחר באותה מידה ובאותו מדד עומס ומהירות.', null, true, 30),
  ('alignment', 'כיוון פרונט', 'tires', 1.0, 250, null,
   '3 חודשים', null, null, 'עבודה בלבד, בלי חלקים.', true, 31),
  ('tire-puncture', 'תיקון תקר', 'tires', 0.3, 80, null,
   'ללא', null, null, 'עבודה וחומר תיקון בלבד.', true, 32),
  ('battery', 'החלפת מצבר', 'electric', 0.5, 780, 550,
   '24 חודשים', '12 חודשים',
   'מקורי: מצבר של יצרן הרכב. חלופי: מצבר של יצרן מוכר באותה קיבולת. ההבדל בעיקר באחריות.', null, false, 40),
  ('bulb-head', 'החלפת נורה ראשית', 'electric', 0.3, 120, 70,
   '6 חודשים', '3 חודשים',
   'מקורי: נורה של יצרן הרכב. חלופי: נורה מאושרת לשימוש בכביש של יצרן מוכר.', null, true, 41),
  ('spark-plugs', 'החלפת מצתים', 'engine', 1.0, 520, 360,
   '12 חודשים או 20,000 ק"מ', '6 חודשים או 10,000 ק"מ',
   'מקורי: מצתים של יצרן הרכב. חלופי: יצרן מוכר באותו מפרט.', null, false, 50),
  ('water-pump', 'החלפת משאבת מים', 'engine', 3.0, 1650, 1150,
   '12 חודשים או 20,000 ק"מ', '6 חודשים או 10,000 ק"מ',
   'מקורי: משאבה של יצרן הרכב. חלופי: יצרן מוכר באותו מפרט. המקורי מחזיק בדרך כלל יותר זמן.', null, false, 51),
  ('timing-belt', 'החלפת רצועת טיימינג ומשאבת מים', 'engine', 5.0, 3400, 2500,
   '24 חודשים או 40,000 ק"מ', '12 חודשים או 20,000 ק"מ',
   'מקורי: ערכה של יצרן הרכב. חלופי: ערכה של יצרן מוכר שמספק גם ליצרני רכב.', null, false, 52),
  ('belt-accessory', 'החלפת רצועת אביזרים', 'engine', 0.8, 480, 320,
   '12 חודשים או 20,000 ק"מ', '6 חודשים או 10,000 ק"מ',
   'מקורי: רצועה של יצרן הרכב. חלופי: רצועה של יצרן מוכר באותה מידה. ההבדל בעיקר באורך החיים.', null, false, 54),
  ('air-filters', 'החלפת מסנן אוויר ומסנן מזגן', 'service', 0.5, 280, 190,
   '6 חודשים', '6 חודשים',
   'מקורי: מסננים של יצרן הרכב. חלופי: יצרן מוכר באותה מידה.', null, false, 53),
  ('ac-gas', 'מילוי גז מזגן ובדיקת דליפה', 'ac', 1.0, 450, null,
   '3 חודשים', null, null, 'יש סוג גז אחד שמתאים לרכב, לפי היצרן. אין חלופה.', false, 60),
  ('ac-compressor', 'החלפת מדחס מזגן', 'ac', 3.5, 4200, 2800,
   '12 חודשים', '6 חודשים',
   'מקורי: מדחס של יצרן הרכב. חלופי: מדחס חדש של יצרן מוכר (לא משופץ).', null, false, 61),
  ('shocks-front', 'החלפת בולמי זעזועים קדמיים (זוג)', 'suspension', 2.5, 2300, 1500,
   '24 חודשים', '12 חודשים',
   'מקורי: בולמים של יצרן הרכב. חלופי: יצרן בולמים מוכר באותו מפרט.', null, false, 70),
  ('wipers', 'החלפת מגבים (זוג)', 'other', 0.2, 180, 110,
   '6 חודשים', '3 חודשים',
   'מקורי: מגבים של יצרן הרכב. חלופי: יצרן מוכר באותה מידה.', null, false, 80)
on conflict (code) do nothing;
