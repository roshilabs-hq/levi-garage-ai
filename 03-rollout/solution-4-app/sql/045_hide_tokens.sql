-- 045: הקישור של הלקוח (הטוקן) רק אצל דניאל ואבי (בדיקת OWASP, 4.10, ממצא M-2).
--
-- הטוקן בקישור /approve/... הוא המפתח של הלקוח: מי שמחזיק אותו יכול לאשר בשמו.
-- עד היום כל עובד, כולל מכונאי והמשתמש של מסך הסדנה, יכול היה לקרוא אותו מהטבלאות
-- approvals ו-quote_requests. עכשיו העמודה token סגורה לקריאה ישירה, וכל שאר
-- העמודות נשארות פתוחות כמו קודם (מסך הליפט, הלוח והמדדים משתמשים בהן).
-- דניאל ואבי מקבלים את הטוקן דרך שלוש פונקציות שבודקות את התפקיד.

revoke select on public.approvals from authenticated, anon;
grant select (id, finding_id, channel, message_text, price_chosen, part_choice, decision, sent_at, decided_at, expires_at, photo_paths, nudged_at, request_id)
  on public.approvals to authenticated;
-- לאורחים אין שום מדיניות RLS על הטבלה, אבל גם ההרשאות עצמן לא צריכות להיות שם.
revoke insert, update, delete, truncate on public.approvals from anon;

revoke select on public.quote_requests from authenticated;
grant select (id, job_card_id, sent_at, sent_by, expires_at, nudged_at, decided_at, kind, decision)
  on public.quote_requests to authenticated;

create or replace function private.require_manager()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_role() is distinct from 'owner' and public.my_role() is distinct from 'manager' then
    raise exception 'only the foreman or the owner' using errcode = '42501';
  end if;
end;
$$;

-- אחרי שליחה: איזו בקשה נוצרה לטוקן הזה.
create or replace function public.request_id_by_token(p_token text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_manager();
  return (select id from public.quote_requests where token = p_token);
end;
$$;

-- התמונות שהלקוח רואה נשמרות תחת הטוקן של כל ממצא בבקשה.
create or replace function public.request_approval_tokens(p_request_id bigint)
returns table (finding_id bigint, token text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_manager();
  return query select a.finding_id, a.token from public.approvals a where a.request_id = p_request_id;
end;
$$;

-- כרטיס העבודה: "הקישור שנשלח ללקוח", לכל בקשה ולכל ממצא ישן.
create or replace function public.staff_job_tokens(p_job_id bigint)
returns table (kind text, ref bigint, token text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_manager();
  return query
    select 'request'::text, r.id, r.token from public.quote_requests r where r.job_card_id = p_job_id
    union all
    select 'approval'::text, a.finding_id, a.token
      from public.approvals a join public.findings f on f.id = a.finding_id
     where f.job_card_id = p_job_id;
end;
$$;

revoke execute on function private.require_manager() from public, anon, authenticated;
revoke execute on function public.request_id_by_token(text) from public, anon;
revoke execute on function public.request_approval_tokens(bigint) from public, anon;
revoke execute on function public.staff_job_tokens(bigint) from public, anon;
grant execute on function public.request_id_by_token(text) to authenticated;
grant execute on function public.request_approval_tokens(bigint) to authenticated;
grant execute on function public.staff_job_tokens(bigint) to authenticated;
