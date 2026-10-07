-- 051: מכונאי פועל רק על רכב שבמוסך עכשיו, ורק על הליפט שלו (ביקורת אבטחה חיצונית, 7.10, ממצא 1).
--
-- עד היום ההרשאה הייתה "הוא עובד מוסך, אז מותר לו כל job_id": מדיניות ה-RLS נתנה לכל איש צוות
-- לעדכן כל כרטיס, ממצא, בדיקה ומדיה, ו-set_inspection_item קישרה ממצא בלי לבדוק שהוא של אותו רכב.
-- כללי העבודה עצמם (רק דניאל מסמן "מוכן", אין שינוי מחיר אחרי שליחה) כבר נאכפים בטריגרים (043).
--
-- מעכשיו, למכונאי:
--   · רק כרטיס פעיל (open, in_progress, waiting_quote, waiting_approval). לא כרטיס סגור, שנמסר או בוטל.
--   · רק רכב שעל הליפט שהוא עובד עליו (staff.lift, נקבע בכניסה לעמדה), או רכב שעוד לא על ליפט
--     (תור, אבחון, חניה, בחוץ). מכונאי בעמדת האבחון (lift ריק) נוגע רק ברכבים שלא על ליפט.
--   · ממצא ותמונה שייכים לאותו כרטיס.
-- מנהל ובעלים: בלי שינוי.
--
-- הערה: המכונאי בוחר בעצמו על איזה ליפט הוא עובד (set_my_lift), בכוונה. במוסך של ארבעה ליפטים
-- מכונאי ניגש לכל רכב. מה שנסגר כאן הוא פעולה על כרטיס שרירותי, בלי קשר למקום שבו הוא עומד.
-- בלי drop: alter policy משנה את התנאים במקום.

create or replace function public.my_lift()
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select s.lift from public.staff s where s.id = (select auth.uid()) and s.active
$$;

create or replace function public.can_touch_job(p_job_id bigint)
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
         and j.status in ('open', 'in_progress', 'waiting_quote', 'waiting_approval')
         and (j.lift is null or j.lift = public.my_lift())
    )
    else false
  end
$$;

revoke execute on function public.my_lift() from public, anon;
revoke execute on function public.can_touch_job(bigint) from public, anon;
grant execute on function public.my_lift() to authenticated;
grant execute on function public.can_touch_job(bigint) to authenticated;

-- ---------------------------------------------------------------- כרטיסים
-- עדכון: המכונאי רואה בתנאי רק כרטיס פעיל שעל הליפט שלו או בלי ליפט, ואחרי העדכון הרכב
-- נשאר על הליפט שלו או יורד ממנו (למשל "להוריד לחניה").
alter policy job_cards_staff_update on public.job_cards
  using (
    public.my_role() in ('owner', 'manager')
    or (public.my_role() = 'mechanic'
        and status in ('open', 'in_progress', 'waiting_quote', 'waiting_approval')
        and (lift is null or lift = public.my_lift()))
  )
  with check (
    public.my_role() in ('owner', 'manager')
    or (public.my_role() = 'mechanic' and (lift is null or lift = public.my_lift()))
  );

-- כרטיס חדש נפתח רק בדלפק (קבלת רכב, רכב בלי תור). אף מסך של מכונאי לא פותח כרטיס.
alter policy job_cards_staff_write on public.job_cards
  with check (public.my_role() in ('owner', 'manager'));

-- ---------------------------------------------------------------- ממצאים, בדיקות, מדיה
alter policy findings_staff_write on public.findings
  with check (public.can_touch_job(job_card_id));
alter policy findings_staff_update on public.findings
  using (public.can_touch_job(job_card_id))
  with check (public.can_touch_job(job_card_id));

-- inspections_write היא ALL. הקריאה ממשיכה דרך inspections_read, ולכן כאן נסגרת רק הכתיבה בפועל.
alter policy inspections_write on public.inspections
  using (public.can_touch_job(job_card_id))
  with check (public.can_touch_job(job_card_id));

alter policy media_staff_write on public.media
  with check (
    public.can_touch_job(job_card_id)
    and (finding_id is null
         or exists (select 1 from public.findings f where f.id = finding_id and f.job_card_id = media.job_card_id))
  );
alter policy media_staff_update on public.media
  using (public.can_touch_job(job_card_id))
  with check (
    public.can_touch_job(job_card_id)
    and (finding_id is null
         or exists (select 1 from public.findings f where f.id = finding_id and f.job_card_id = media.job_card_id))
  );

-- ---------------------------------------------------------------- set_inspection_item
-- כמו ב-027, ועוד שתי בדיקות: מותר לגעת ברכב, והממצא שייך לאותו רכב.
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
  if not public.can_touch_job(p_job_id) then
    raise exception 'this car is not yours to work on' using errcode = '42501', hint = 'not-your-car';
  end if;
  if p_light not in ('green', 'yellow', 'red') or coalesce(p_key, '') !~ '^[a-z_]{2,20}$' then
    raise exception 'bad item' using errcode = '22023';
  end if;
  if p_finding_id is not null
     and not exists (select 1 from public.findings f where f.id = p_finding_id and f.job_card_id = p_job_id) then
    raise exception 'that finding belongs to another car' using errcode = '22023', hint = 'finding-job';
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

-- ---------------------------------------------------------------- add_price_list_finding
-- כמו ב-027, ועוד בדיקה אחת: מותר לגעת ברכב.
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
  if not public.can_touch_job(p_job_id) then
    raise exception 'this car is not yours to work on' using errcode = '42501', hint = 'not-your-car';
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
