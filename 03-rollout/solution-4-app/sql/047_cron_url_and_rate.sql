-- 047: שתי הקשחות קטנות (בדיקת OWASP, 4.10).
--
-- 1. M-3: משימת התזכורות (pg_cron, quote-nudges) שלחה את הסוד לכתובת
--    levi-garage.vercel.app. אם הפרויקט ב-Vercel יעבור או יימחק ומישהו אחר יתפוס
--    את השם, הוא יקבל את הסוד כל 5 דקות. עכשיו היא פונה לדומיין שלנו. בוצע ב-4.10
--    עם cron.alter_job(1, command := ...), עם אותה פקודה ורק כתובת אחרת.
--    עוד לא בוצע: לפצל את garage_bot_token לסודות נפרדים (cron, בוט, HMAC).
--
-- 2. M-5: הגבלת קצב משותפת לכל שרתי Vercel. עד היום ההגבלה הייתה בזיכרון של כל
--    שרת לחוד, ומתאפסת בכל הפעלה קרה. כל פנייה ל"תשאלו אותנו" היא קריאה ל-Gemini
--    שעולה כסף. הפונקציה רושמת פגיעה ועונה אם עוד מותר, ומנקה אחריה.

-- מונה אחד לכל מפתח, שמתאפס כשהחלון עובר. בלי DELETE: ה-MCP של Supabase מסווג
-- מחיקה כהרסנית ולא מאשר אותה מרחוק.
create table if not exists private.rate_counters (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

create or replace function public.rate_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  if p_key is null or length(p_key) > 120 or p_window_seconds not between 1 and 86400 or p_max not between 1 and 10000 then
    return false;
  end if;
  insert into private.rate_counters as c (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set window_start = case when c.window_start < now() - make_interval(secs => p_window_seconds) then now() else c.window_start end,
        hits = case when c.window_start < now() - make_interval(secs => p_window_seconds) then 1 else c.hits + 1 end
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

revoke execute on function public.rate_hit(text, integer, integer) from public;
grant execute on function public.rate_hit(text, integer, integer) to anon, authenticated;
