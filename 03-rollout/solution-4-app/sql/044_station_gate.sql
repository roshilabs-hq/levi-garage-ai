-- 044: ה"חיבור ההפוך" של עמדה רק דרך השרת שלנו (בדיקת OWASP, 4.10, ממצא M-1).
--
-- עד היום ארבע הפונקציות של חיבור עמדה היו פתוחות לכל העולם (anon), עם המפתח
-- הציבורי של האתר. מי שרצה יכול היה לפתוח בקשה, לקבל את רשימת המאשרים, ולנחש
-- את הקוד של דניאל או של אבי, או פשוט לנעול אותו שוב ושוב.
--
-- עכשיו כל קריאה צריכה מפתח שרק השרת שלנו יודע: HMAC של STATION_SECRET (שכבר
-- יושב ב-Vercel) על המילה "station-rpc". במסד נשמר רק ה-SHA-256 שלו, כך שגם
-- מי שקורא את המסד לא יכול לשחזר את המפתח. הפונקציות הישנות נסגרות לאורחים,
-- והחדשות (אותו שם, עם p_key) בודקות את המפתח ואז קוראות לישנות.

insert into private.settings (key, value)
values ('station_rpc_hash', 'f1c5965e7688275c7e9901a3563f6b5c95b0dfa1c1c5a9d5c0574bdd5beed6e7')
on conflict (key) do update set value = excluded.value;

create or replace function private.check_station_key(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key is null
     or encode(extensions.digest(p_key, 'sha256'), 'hex')
        is distinct from (select value from private.settings where key = 'station_rpc_hash') then
    raise exception 'only the garage server pairs a station' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.request_station(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_station_key(p_key);
  return public.request_station();
end;
$$;

create or replace function public.station_request_status(p_secret text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_station_key(p_key);
  return public.station_request_status(p_secret);
end;
$$;

create or replace function public.station_request_approvers(p_secret text, p_key text)
returns table (id uuid, full_name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_station_key(p_key);
  return query select * from public.station_request_approvers(p_secret);
end;
$$;

create or replace function public.approve_station_request_with_pin(p_secret text, p_staff_id uuid, p_pin text, p_lift smallint, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_station_key(p_key);
  return public.approve_station_request_with_pin(p_secret, p_staff_id, p_pin, p_lift);
end;
$$;

revoke execute on function public.request_station() from anon, authenticated, public;
revoke execute on function public.station_request_status(text) from anon, authenticated, public;
revoke execute on function public.station_request_approvers(text) from anon, authenticated, public;
revoke execute on function public.approve_station_request_with_pin(text, uuid, text, smallint) from anon, authenticated, public;

revoke execute on function public.request_station(text) from public;
revoke execute on function public.station_request_status(text, text) from public;
revoke execute on function public.station_request_approvers(text, text) from public;
revoke execute on function public.approve_station_request_with_pin(text, uuid, text, smallint, text) from public;
grant execute on function public.request_station(text) to anon, authenticated;
grant execute on function public.station_request_status(text, text) to anon, authenticated;
grant execute on function public.station_request_approvers(text, text) to anon, authenticated;
grant execute on function public.approve_station_request_with_pin(text, uuid, text, smallint, text) to anon, authenticated;
revoke execute on function private.check_station_key(text) from public, anon, authenticated;
