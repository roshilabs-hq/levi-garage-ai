-- 050: הכרעה של לקוח חלה רק על ממצאים של הבקשה שלו (בדיקת האבטחה המסכמת, 6.10, ממצא H-1).
--
-- עד עכשיו request_decide עדכנה את findings לפי finding_id שהגיע מהדפדפן, בלי לבדוק שהממצא
-- שייך לבקשה של הקישור. העדכון של approvals כן היה מוגבל לבקשה, אבל השורה של findings לא:
-- לקוח עם קישור תקף יכול היה לשלוח מספר של ממצא ברכב אחר (המספרים רצים), והממצא שם היה
-- מסומן "אושר" או "נדחה" בלי שהלקוח שלו ענה. זה נוגע ישירות לס' 132 לחוק (אישור בכתב).
--
-- התיקון מהשורש, בלי לשנות את הזרימה הרגילה:
--   1. כל פריט ברשימה חייב להיות ממצא שממתין לתשובה בבקשה הזאת. אחרת: שגיאה, ושום דבר לא משתנה.
--   2. העדכון של findings מוגבל גם לרכב של הבקשה.
-- כל השאר כמו ב-028.

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
    -- 050: רק ממצא שממתין לתשובה בבקשה הזאת. מספר של ממצא אחר עוצר הכול (הטרנזקציה מתבטלת).
    if not exists (
      select 1 from public.approvals a
       where a.finding_id = v_fid and a.request_id = v_req.id and a.decision is null
    ) then
      raise exception 'not part of this request' using errcode = '22023';
    end if;
    if v_dec not in ('approved', 'declined') then
      raise exception 'decision must be approved or declined' using errcode = '22023';
    end if;
    v_price := null;
    if v_dec = 'approved' then
      if v_choice not in ('original', 'aftermarket') then
        raise exception 'choose an original or an aftermarket part' using errcode = '22023';
      end if;
      select case when v_choice = 'original' then f.price_original else f.price_aftermarket end
        into v_price from public.findings f where f.id = v_fid and f.job_card_id = v_req.job_card_id;
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
     where id = v_fid and job_card_id = v_req.job_card_id and status = 'sent';
  end loop;

  update public.quote_requests set decided_at = now() where id = v_req.id;
  -- הלקוח ענה על הכול. אם בינתיים המכונאי מצא עוד משהו שדניאל עוד לא שלח,
  -- הכרטיס "מחכה לשליחה" ולא "בעבודה" (סבב 2.10, ממצא 9).
  update public.job_cards
     set status = case
       when exists (select 1 from public.findings f where f.job_card_id = v_req.job_card_id and f.status = 'draft')
         then 'waiting_quote' else 'in_progress' end
   where id = v_req.job_card_id and status = 'waiting_approval'
     and not exists (select 1 from public.findings f where f.job_card_id = v_req.job_card_id and f.status = 'sent');
  return 'done';
end;
$$;
revoke all on function public.request_decide(text, jsonb) from public;
grant execute on function public.request_decide(text, jsonb) to anon, authenticated;
