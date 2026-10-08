-- 066: שלמות האבחון, "סיימתי" עם אישור כשירות, וכניסה בעמדה שפגה בסוף משמרת
-- (ביקורת אבטחה חמישית, 8.10, ממצאים 1, 3, 4, 6).
--
-- 1 (גבוה). 063 סגרה את "האבחון הסתיים", אבל לא את התוכן שלו: מכונאי יכול היה לכתוב ישירות את
--    inspections.items, עם finding_id כלשהו, ואז complete_inspection הסתפקה בכך שהשדה לא ריק.
--    עכשיו:
--      · כל כתיבה ישירה לטבלת האבחון, בשם משתמש, נחסמת. הכתיבות עוברות רק דרך set_inspection_item
--        (שבודקת שהממצא שייך לרכב, 051) ו-complete_inspection.
--      · complete_inspection בודקת שכל ממצא של צהוב או אדום קיים, שייך לרכב הזה, ולא בוטל.
--      · אחרי שהאבחון הסתיים, מכונאי לא משנה אותו. דניאל ואבי כן, אם צריך לתקן.
-- 3. "סיימתי" (finish_on_lift) מוריד את הרכב מהליפט, ולכן דורש את אותו אישור כמו "להוריד לחניה":
--    "הרכב סגור, מורכב, ואפשר לנסוע בו". הגרסה הישנה, בלי האישור, נסגרת (revoke, בלי drop).
-- 4. כניסה בעמדה פגה אחרי 12 שעות (משמרת): מכשיר שנשאר מחובר בלילה לא ממשיך לפעול בשם המכונאי.
--    אותו מנגנון כמו עמדה שבוטלה (057, 064). בנוסף, במסך: 30 דקות בלי מגע מחזירות לרשימת השמות.
-- בלי drop.

-- 1 -------------------------------------------------------------------------------------------
create or replace function private.inspections_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'inspections are written only through set_inspection_item and complete_inspection'
    using errcode = '42501', hint = 'inspect-rpc';
end;
$$;
create or replace trigger inspections_guard before insert or update or delete on public.inspections
  for each row execute function private.inspections_guard();

create or replace function public.complete_inspection(p_job_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_key text;
  v_finding text;
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager', 'mechanic') or not public.can_touch_job(p_job_id) then
    raise exception 'not your car' using errcode = '42501', hint = 'not-your-car';
  end if;
  select items into v_items from public.inspections where job_card_id = p_job_id for update;
  foreach v_key in array array['brakes', 'tires', 'steering', 'lights', 'fluids', 'leaks', 'battery', 'wipers', 'scan'] loop
    if coalesce(v_items -> v_key ->> 'light', '') not in ('green', 'yellow', 'red') then
      raise exception 'inspection item % is not marked', v_key using errcode = '22023', hint = 'inspect-incomplete';
    end if;
    if v_items -> v_key ->> 'light' in ('yellow', 'red') then
      v_finding := v_items -> v_key ->> 'finding_id';
      -- הממצא קיים, שייך לרכב הזה, ולא בוטל. לא מספיק שהשדה לא ריק.
      if v_finding is null or v_finding !~ '^\d{1,18}$' or not exists (
        select 1 from public.findings f
         where f.id = v_finding::bigint and f.job_card_id = p_job_id and f.status <> 'cancelled'
      ) then
        raise exception 'inspection item % has no valid finding', v_key using errcode = '22023', hint = 'inspect-incomplete';
      end if;
    end if;
  end loop;

  update public.inspections set completed_at = now() where job_card_id = p_job_id;
  update public.job_cards set inspected_at = now(), inspected_by = (select auth.uid()) where id = p_job_id;
  return 'ok';
end;
$$;

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
  -- 066: אבחון שהסתיים נשאר כמו שהוא. רק דניאל או אבי מתקנים אחרי זה.
  if public.my_role() = 'mechanic'
     and exists (select 1 from public.inspections i where i.job_card_id = p_job_id and i.completed_at is not null) then
    raise exception 'the inspection is already completed' using errcode = '42501', hint = 'inspection-closed';
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

-- 3 -------------------------------------------------------------------------------------------
create or replace function public.finish_on_lift(p_job_id bigint, p_fit boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(p_fit, false) then
    raise exception 'confirm the car is closed and fit to drive' using errcode = '22023', hint = 'fit-required';
  end if;
  return private.lower_from_lift(p_job_id, true);
end;
$$;
revoke all on function public.finish_on_lift(bigint, boolean) from public, anon;
grant execute on function public.finish_on_lift(bigint, boolean) to authenticated;
-- הישנה, בלי האישור: סגורה לכולם
revoke execute on function public.finish_on_lift(bigint) from public, anon, authenticated;

-- 4 -------------------------------------------------------------------------------------------
create or replace function private.session_revoked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.station_sessions ss
      join public.stations st on st.id = ss.station_id
     where ss.session_id = private.my_session_id()
       and (st.revoked_at is not null or ss.created_at < now() - interval '12 hours')
  )
$$;

create or replace function public.my_station_session()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'bound', b.session_id is not null,
    'lift', b.lift,
    'revoked', coalesce(st.revoked_at is not null or b.created_at < now() - interval '12 hours', false)
  )
    from (select 1) one
    left join public.station_sessions b on b.session_id = private.my_session_id() and b.staff_id = (select auth.uid())
    left join public.stations st on st.id = b.station_id
$$;
