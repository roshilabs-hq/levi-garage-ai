-- 034: "לא לאשר" לבקשה של מכשיר (רועי, 2.10: "יש רק כפתור אישור... אחרת זה חונה שם").
--
-- בקשה שנפתחה בטעות, או ממכשיר שלא מכירים, יוצאת מהלוח של דניאל מיד, ולא
-- מחכה רבע שעה. הדחייה גם סוגרת את הבקשה (expires_at = עכשיו), ולכן כל בדיקה
-- קיימת ב-032 וב-033 כבר מתייחסת אליה כסגורה; כאן רק נוסף שהטאבלט יודע שנדחתה.

alter table public.station_requests add column if not exists declined_at timestamptz;

create or replace function public.decline_station_request(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can decline a station' using errcode = '42501';
  end if;
  update public.station_requests
     set declined_at = now(), expires_at = now()
   where id = p_id and approved_at is null and consumed_at is null and declined_at is null;
  if not found then
    return 'gone';
  end if;
  return 'ok';
end
$$;
revoke all on function public.decline_station_request(uuid) from public, anon;
grant execute on function public.decline_station_request(uuid) to authenticated;

-- כמו ב-032, ועוד מצב אחד: "declined".
create or replace function public.station_request_status(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.station_requests%rowtype;
  v_token text;
  v_station uuid;
begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('status', 'bad');
  end if;
  select * into v_row from public.station_requests
   where secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
   for update;
  if not found then
    return jsonb_build_object('status', 'bad');
  end if;
  if v_row.consumed_at is not null then
    return jsonb_build_object('status', 'used');
  end if;
  if v_row.declined_at is not null then
    return jsonb_build_object('status', 'declined');
  end if;
  if v_row.approved_at is null then
    if v_row.expires_at <= now() then
      return jsonb_build_object('status', 'expired');
    end if;
    return jsonb_build_object('status', 'pending', 'code', v_row.code);
  end if;
  if v_row.approved_at < now() - interval '15 minutes' then
    return jsonb_build_object('status', 'expired');
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.stations (label, lift, token_hash, created_by)
  values (v_row.label, v_row.lift, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_row.approved_by)
  returning id into v_station;
  update public.station_requests set consumed_at = now(), station_id = v_station where id = v_row.id;
  return jsonb_build_object('status', 'approved', 'token', v_token, 'label', v_row.label);
end
$$;
