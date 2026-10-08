-- 061: ניקוי חודשי (ביקורות 7.10-8.10: "המחיקה ידנית"). מ-Vercel Cron (app/api/cron/housekeeping).
--
--   · מוחק רק נתונים טכניים, בלי מידע על לקוחות: רישומי כניסה בעמדה מעל 30 יום, מוני קצב ישנים,
--     בקשות חיבור וקודי צימוד שפגו, ואירועי אבטחה מעל שנה.
--   · נתוני לקוחות (כרטיסים ותורים מעל 3 שנים, תמונות בקישורים שפגו) רק נספרים ומדווחים, ולא נמחקים:
--     מחיקה אוטומטית שאי אפשר לשחזר תופעל רק אחרי פיילוט, כשמישהו אחראי לה.
--   · הדוח נרשם ביומן האבטחה (060), ואבי רואה מתי רץ ומה נמצא.
-- הקריאה דורשת סוד שנמצא רק בשרת, נגזר מ-STATION_SECRET (כמו 052). במסד רק הגיבוב.
--
-- מוחלת ידנית, ב-SQL Editor של Supabase: כלי ההחלה (MCP) דוחה כל מיגרציה שיש בה delete.

insert into private.settings (key, value)
values ('housekeeping_rpc_hash', '065b8acc10e1830d8c9e03bccaab7bd58dcf06bebb556b236efa799330b898e3')
on conflict (key) do update set value = excluded.value;

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
  delete from public.station_sessions where created_at < now() - interval '30 days';
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
