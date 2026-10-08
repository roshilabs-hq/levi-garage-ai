-- 065: הניקוי החודשי לא מוחק רישום של כניסה שעוד חיה (ביקורת אבטחה רביעית, 8.10, ממצא 8).
--
-- 061 מחקה רישומי כניסה בעמדה אחרי 30 יום. הביטול של עמדה (057, 064) נשען על הרישום הזה: בלעדיו
-- אי אפשר לדעת שהכניסה הגיעה מעמדה שבוטלה. אם הסשן של Supabase עוד חי (חידוש טוקן), מחיקת הרישום
-- הייתה מחזירה לו את ההרשאות. עכשיו נמחק רק רישום שהסשן שלו כבר לא קיים ב-auth.sessions.
--
-- הוחלה ידנית ב-SQL Editor של Supabase (8.10), כמו 061, כי כלי ההחלה דוחה delete.

create or replace function public.housekeeping(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sessions int;
  v_counters int;
  v_requests int;
  v_codes int;
  v_events int;
  v_report jsonb;
begin
  if p_secret is null
     or encode(extensions.digest(p_secret, 'sha256'), 'hex')
        is distinct from (select value from private.settings where key = 'housekeeping_rpc_hash') then
    raise exception 'only the garage server runs housekeeping' using errcode = '42501';
  end if;

  -- נתונים טכניים בלבד
  -- 065: רק רישום שהסשן שלו כבר לא קיים. רישום של כניסה חיה (במיוחד מעמדה שבוטלה) נשאר, כי בלעדיו
  -- הכניסה הייתה "שוכחת" שהעמדה בוטלה.
  delete from public.station_sessions ss
   where ss.created_at < now() - interval '30 days'
     and not exists (select 1 from auth.sessions a where a.id = ss.session_id);
  get diagnostics v_sessions = row_count;
  delete from private.rate_counters where window_start < now() - interval '2 days';
  get diagnostics v_counters = row_count;
  delete from public.station_requests where expires_at < now() - interval '30 days';
  get diagnostics v_requests = row_count;
  delete from public.station_pair_codes where expires_at < now() - interval '1 day';
  get diagnostics v_codes = row_count;
  delete from private.security_events where at < now() - interval '1 year';
  get diagnostics v_events = row_count;

  v_report := jsonb_build_object(
    'deleted', jsonb_build_object('station_sessions', v_sessions, 'rate_counters', v_counters,
                                  'station_requests', v_requests, 'pair_codes', v_codes, 'security_events', v_events),
    -- נתוני לקוחות: נספרים בלבד. המחיקה עצמה ידנית, לפי מדיניות הפרטיות.
    'due_for_manual_deletion', jsonb_build_object(
      'job_cards_over_3_years', (
        select count(*) from public.job_cards
         where status in ('delivered', 'cancelled') and coalesce(delivered_at, opened_at) < now() - interval '3 years'),
      'bookings_over_3_years', (
        select count(*) from public.bookings where drop_off_at < now() - interval '3 years'),
      'shared_photos_of_closed_links', (
        select count(*) from storage.objects o
         where o.bucket_id = 'shared-quotes'
           and not exists (select 1 from public.approvals a
                            where o.name = any (a.photo_paths) and (a.expires_at is null or a.expires_at > now())))
    )
  );
  insert into private.security_events (kind, detail) values ('housekeeping', v_report);
  return v_report;
end;
$$;
revoke all on function public.housekeeping(text) from public;
grant execute on function public.housekeeping(text) to anon, authenticated;
