-- 020: הנחה על ממצא (28.9).
--
-- ההחלטה של רועי: הנחה — רק מנהל העבודה או הבעלים, ועם סיבה. דניאל עד 10%,
-- ומעל זה רק אבי. ולמה בכלל: באפיון, 2,000–2,500 ש"ח בחודש הולכים על הנחות,
-- רובן התנצלות על עיכוב. אם המערכת עובדת, המספר הזה יורד — וכדי לדעת, כל
-- הנחה נרשמת: כמה, למה ומי.
--
-- איך: price_original/price_aftermarket נשארים "המחיר שהלקוח רואה ומאשר", ולכן
-- האישור, המחיר שנבחר וההצעה המעודכנת במייל לא משתנים. לידם נשמרים מחיר
-- המחירון והאחוז, והמחיר הסופי תמיד מחושב מהם כאן — אין דרך להקליד מחיר
-- "מוזל" שלא מתאים לאחוז.

alter table public.findings add column if not exists list_price_original numeric(10, 2);
alter table public.findings add column if not exists list_price_aftermarket numeric(10, 2);
alter table public.findings add column if not exists discount_pct numeric(4, 1) not null default 0;
alter table public.findings add column if not exists discount_reason text;
alter table public.findings add column if not exists discount_by uuid references public.staff (id);
alter table public.findings drop constraint if exists findings_discount_range;
alter table public.findings add constraint findings_discount_range check (discount_pct >= 0 and discount_pct <= 50);

create or replace function public.findings_discount_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
  v_changed boolean := tg_op = 'INSERT' or new.discount_pct is distinct from old.discount_pct;
begin
  if v_changed and tg_op = 'UPDATE' and old.status <> 'draft' then
    raise exception 'the price was already sent to the customer' using errcode = '22023', hint = 'discount-sent';
  end if;

  if v_changed and new.discount_pct > 0 then
    if coalesce(btrim(new.discount_reason), '') = '' then
      raise exception 'a discount needs a reason' using errcode = '22023', hint = 'discount-reason';
    end if;
    if (select auth.uid()) is not null then
      select s.role into v_role from public.staff s where s.id = (select auth.uid()) and s.active;
      if v_role is null or v_role not in ('owner', 'manager') then
        raise exception 'only the foreman or the owner can give a discount' using errcode = '42501', hint = 'discount-role';
      end if;
      if new.discount_pct > 10 and v_role <> 'owner' then
        raise exception 'above 10 percent only the owner' using errcode = '42501', hint = 'discount-owner';
      end if;
    end if;
    new.discount_by := (select auth.uid());
  elsif v_changed then
    new.discount_reason := null;
    new.discount_by := null;
  end if;

  if new.list_price_original is not null then
    new.price_original := round(new.list_price_original * (100 - new.discount_pct) / 100);
  end if;
  if new.list_price_original is not null then
    new.price_aftermarket := case
      when new.list_price_aftermarket is null then null
      else round(new.list_price_aftermarket * (100 - new.discount_pct) / 100)
    end;
  end if;
  return new;
end
$$;

drop trigger if exists findings_discount on public.findings;
create trigger findings_discount before insert or update on public.findings
  for each row execute function public.findings_discount_rules();

-- דף האישור: הלקוח רואה את מחיר המחירון, את ההנחה ואת המחיר שלו.
drop function if exists public.approval_view(text);
create function public.approval_view(p_token text)
returns table (
  message_text text, title text, price_original numeric, price_aftermarket numeric, labor_hours numeric,
  warranty_original text, warranty_aftermarket text, part_diff text, single_reason text, safety boolean, eta text,
  photo_paths text[], decision text, decided_at timestamptz, part_choice text, expired boolean, plate_last3 text, vehicle text,
  list_price_original numeric, list_price_aftermarket numeric, discount_pct numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.message_text, f.title, f.price_original, f.price_aftermarket, f.labor_hours,
    f.warranty_original, f.warranty_aftermarket, f.part_diff, f.single_reason, f.safety, f.eta,
    a.photo_paths, a.decision, a.decided_at, a.part_choice,
    (now() > a.expires_at) as expired,
    right(j.plate, 3) as plate_last3,
    btrim(coalesce(j.vehicle_make, '') || ' ' || coalesce(j.vehicle_model, '')) as vehicle,
    case when f.discount_pct > 0 then f.list_price_original end,
    case when f.discount_pct > 0 then f.list_price_aftermarket end,
    f.discount_pct
  from public.approvals a
  join public.findings f on f.id = a.finding_id
  join public.job_cards j on j.id = f.job_card_id
  where a.token = p_token
$$;
revoke all on function public.approval_view(text) from public;
grant execute on function public.approval_view(text) to anon, authenticated;

-- ההצעה במייל: אותו מחיר, ועוד שורה שאומרת שיש בו הנחה.
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
               'decided_at', a.decided_at,
               'discount_pct', f.discount_pct
             ) order by f.created_at)
      from public.findings f
      left join public.approvals a on a.finding_id = f.id
      where f.job_card_id = j.id and f.status in ('sent', 'approved', 'declined')
    ), '[]'::jsonb)
  )
  from public.job_cards j
  where j.id = p_job_id
$$;
