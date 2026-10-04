-- 042: בקשת הנחה מעל 10%, מדניאל לאבי (4.10, ההרצה של רועי).
--
-- עד היום (020) דניאל יכול לתת עד 10%, ומעל זה רק אבי, אבל לא הייתה במערכת דרך
-- לבקש: דניאל היה מתקשר לאבי, ובמדדים יש בדיוק מדד של "כמה פעמים התקשרו לאבי".
-- עכשיו דניאל מבקש מתוך הממצא (אחוז וסיבה), אבי רואה את הבקשה בלוח שלו ובסרגל
-- העליון, ומאשר או דוחה בלחיצה. עד שאבי עונה, הממצא לא יוצא ללקוח.
--
-- הבקשה יושבת על הממצא עצמו: ממצא אחד, בקשה פתוחה אחת לכל היותר. כשאבי מאשר,
-- ההנחה נכתבת דרך אותו טריגר של 020 (findings_discount_rules), עם אבי כמי שנתן,
-- וכך כל הכללים (סיבה, תקרה, רק לפני שליחה) נבדקים במקום אחד.

alter table public.findings add column if not exists discount_request_pct numeric(4, 1);
alter table public.findings add column if not exists discount_request_reason text;
alter table public.findings add column if not exists discount_request_by uuid references public.staff (id);
alter table public.findings add column if not exists discount_request_at timestamptz;

-- דניאל: לבקש. רק מנהל עבודה (אבי נותן לבד), רק ממצא שעוד לא נשלח, 15–30%, עם סיבה.
create or replace function public.request_discount(p_finding_id bigint, p_pct numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_role() is distinct from 'manager' then
    raise exception 'only the foreman asks the owner for a discount' using errcode = '42501', hint = 'discount-role';
  end if;
  if p_pct is null or p_pct not in (15, 20, 25, 30) then
    raise exception 'a request is for 15 to 30 percent' using errcode = '22023', hint = 'discount-request-pct';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a discount needs a reason' using errcode = '22023', hint = 'discount-reason';
  end if;
  update public.findings
     set discount_request_pct = p_pct,
         discount_request_reason = btrim(p_reason),
         discount_request_by = (select auth.uid()),
         discount_request_at = now()
   where id = p_finding_id and status = 'draft';
  if not found then
    raise exception 'the price was already sent to the customer' using errcode = '22023', hint = 'discount-sent';
  end if;
end;
$$;
revoke all on function public.request_discount(bigint, numeric, text) from public;
grant execute on function public.request_discount(bigint, numeric, text) to authenticated;

-- דניאל: לבטל בקשה (למשל, הלקוח הסתפק ב-10%).
create or replace function public.cancel_discount_request(p_finding_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_role() not in ('owner', 'manager') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.findings
     set discount_request_pct = null, discount_request_reason = null, discount_request_by = null, discount_request_at = null
   where id = p_finding_id and status = 'draft';
end;
$$;
revoke all on function public.cancel_discount_request(bigint) from public;
grant execute on function public.cancel_discount_request(bigint) to authenticated;

-- אבי: לאשר או לדחות. באישור, ההנחה נכתבת על הממצא דרך הטריגר של 020.
create or replace function public.decide_discount(p_finding_id bigint, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.findings%rowtype;
begin
  if public.my_role() is distinct from 'owner' then
    raise exception 'only the owner decides above 10 percent' using errcode = '42501', hint = 'discount-owner';
  end if;
  select * into v_f from public.findings where id = p_finding_id for update;
  if not found or v_f.discount_request_at is null then
    raise exception 'no open request' using errcode = 'P0002', hint = 'discount-no-request';
  end if;
  if v_f.status <> 'draft' then
    raise exception 'the price was already sent to the customer' using errcode = '22023', hint = 'discount-sent';
  end if;
  update public.findings
     set discount_pct = case when p_approve then v_f.discount_request_pct else discount_pct end,
         discount_reason = case when p_approve then v_f.discount_request_reason else discount_reason end,
         discount_request_pct = null, discount_request_reason = null, discount_request_by = null, discount_request_at = null
   where id = p_finding_id;
end;
$$;
revoke all on function public.decide_discount(bigint, boolean) from public;
grant execute on function public.decide_discount(bigint, boolean) to authenticated;
