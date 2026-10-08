-- 055: התמונות בקישור לאישור לא נפתחות אחרי שהקישור פג (ביקורת חוזרת, 8.10, ממצא 5).
--
-- דף האישור חותם על כתובות התמונות (049) לשעה. אם נשארו לקישור עשר דקות, התמונה נשארה פתוחה
-- עוד חמישים דקות אחרי שהקישור עצמו כבר פג. התצוגות (approval_view, request_view) לא מחזירות את
-- מועד הפקיעה, ולשנות את מה שהן מחזירות אפשר רק ב-drop. לכן פונקציה קטנה ונפרדת: כמה שניות נשארו
-- לקישור הזה. בלי הטוקן היא לא מחזירה כלום, ועם הטוקן היא לא מחזירה שום פרט מעבר לזמן.

create or replace function public.link_seconds_left(p_token text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  -- בלי מועד פקיעה (או טוקן שלא קיים): null, והדף נשאר עם השעה הרגילה
  select case when min(e) is null then null else greatest(0, floor(extract(epoch from min(e) - now())))::integer end
    from (
      select a.expires_at as e from public.approvals a where a.token = p_token and a.expires_at is not null
      union all
      select q.expires_at from public.quote_requests q where q.token = p_token and q.expires_at is not null
    ) x
   where p_token is not null and length(p_token) between 16 and 128
$$;

revoke all on function public.link_seconds_left(text) from public;
grant execute on function public.link_seconds_left(text) to anon, authenticated;
