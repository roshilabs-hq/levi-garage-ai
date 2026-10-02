-- 029: בדף האישור, הלקוח רואה גם מה כבר אושר, וכמה זה ביחד (סבב 2.10, ממצא 11).
--
-- עד 2.10 הדף הראה רק את הממצאים של ההודעה הנוכחית, ו"סה"כ למה שאישרת" לא כלל את
-- מה שאושר בקבלה (למשל אבחון, 250). הסכום המלא הגיע רק במייל, אחרי ההחלטה.
--
-- מאותו מקור כמו הצעת המחיר במייל (private.quote_snapshot), כדי שהדף והמייל יגיעו
-- לאותו מספר. מחזיר רק כותרת וסכום לכל שורה: בלי שם, טלפון או פרטי הרכב.
-- הממצאים של הבקשה הנוכחית לא נכללים: עליהם הלקוח מחליט עכשיו.

create or replace function public.request_agreed(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select id, job_card_id from public.quote_requests
     where p_token ~ '^[0-9a-f]{36}$' and token = p_token
  )
  select jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('title', l ->> 'title', 'price', (l ->> 'price')::numeric))
        from jsonb_array_elements(private.quote_snapshot(r.job_card_id) -> 'lines') l
    ), '[]'::jsonb),
    'approved', coalesce((
      select jsonb_agg(jsonb_build_object('title', coalesce(f.title, f.summary), 'price', a.price_chosen) order by a.decided_at)
        from public.findings f
        join public.approvals a on a.finding_id = f.id and a.decision = 'approved'
       where f.job_card_id = r.job_card_id and f.status = 'approved' and a.request_id is distinct from r.id
    ), '[]'::jsonb)
  )
  from r
$$;
revoke all on function public.request_agreed(text) from public;
grant execute on function public.request_agreed(text) to anon, authenticated;
