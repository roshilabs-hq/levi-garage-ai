-- 052: הגבלת הקצב רק מהשרת שלנו (ביקורת אבטחה חיצונית, 7.10, ממצא 4).
--
-- rate_hit (047) הייתה פתוחה ל-anon. כל מי שיש לו את המפתח הציבורי של האתר (הוא בדפדפן) יכול היה
-- לקרוא לה ישירות, עם כל מפתח: למלא את private.rate_counters בשורות, או "לשרוף" את התקרה היומית
-- המשותפת (ask:site:all, training:all) ולהשבית את שני הבוטים לכולם.
--
-- עכשיו הגרסה החדשה דורשת סוד שנמצא רק בשרת: נגזר מ-STATION_SECRET ב-HMAC עם התווית "rate-limit-v1"
-- (lib/site/rate.ts), בלי משתנה חדש ב-Vercel. במסד נשמר רק הגיבוב שלו, כמו station_rpc_hash ב-044. הישנה לא נמחקת (בלי drop), רק נסגרת לכולם.
-- אם הסוד לא מוגדר בשרת, האתר ממשיך לעבוד בלי הגבלה (כמו כשהמסד לא עונה, lib/site/rate.ts).

insert into private.settings (key, value)
values ('rate_rpc_hash', 'cc07099cff2891e965e9a4a7d6f3683f1670ef95c4178bf419ac75dd170f771c')
on conflict (key) do update set value = excluded.value;

create or replace function public.rate_hit(p_key text, p_window_seconds integer, p_max integer, p_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  if p_secret is null
     or encode(extensions.digest(p_secret, 'sha256'), 'hex')
        is distinct from (select value from private.settings where key = 'rate_rpc_hash') then
    raise exception 'only the garage server counts requests' using errcode = '42501';
  end if;
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

revoke execute on function public.rate_hit(text, integer, integer, text) from public;
grant execute on function public.rate_hit(text, integer, integer, text) to anon, authenticated;

-- הישנה, בלי סוד: סגורה לכולם
revoke execute on function public.rate_hit(text, integer, integer) from anon, authenticated, public;
