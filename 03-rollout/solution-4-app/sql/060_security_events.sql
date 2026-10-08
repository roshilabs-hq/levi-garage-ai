-- 060: התראות אבטחה (ביקורות 7.10-8.10: "אין התראות אבטחה").
--
-- 1. יומן אירועי אבטחה (private.security_events). נרשמים בו:
--      · נעילת קוד אישי אחרי 5 טעויות (מכונאי בעמדה, או מנהל שמאשר עמדה). טריגר על staff, כך
--        שכל מסלול שנועל נרשם, בלי לשכפל את פונקציות הכניסה.
--      · חסימה של הגבלת הקצב: הפעם הראשונה שמפתח עובר את התקרה בחלון. מאוחד לפי סוג, ברבע שעה.
--      · תקרת בקשות החיבור לעמדה מלאה (מישהו מציף).
--    אבי ודניאל רואים סיכום בראש מסך המדדים (security_alerts). מייל לא נשלח: כתובות הצוות
--    בהדגמה לא אמיתיות. בפיילוט מוסיפים כתובת אמיתית.
--
-- הניקוי החודשי, שקורא לאותו יומן, ב-061.
--
-- בלי drop.

create table if not exists private.security_events (
  id bigserial primary key,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists security_events_at_idx on private.security_events (at);

-- 1א. נעילת קוד ------------------------------------------------------------------------
create or replace function private.note_pin_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pin_locked_until is not null and new.pin_locked_until > now()
     and new.pin_locked_until is distinct from old.pin_locked_until then
    insert into private.security_events (kind, detail)
    values ('pin_locked', jsonb_build_object('staff_id', new.id, 'role', new.role));
  end if;
  return new;
end;
$$;

create or replace trigger staff_pin_lock_event
  after update of pin_locked_until on public.staff
  for each row execute function private.note_pin_lock();

-- רישום מאוחד: אותו סוג ואותו תחום ברבע השעה האחרונה מגדיל מונה, במקום שורה חדשה.
create or replace function private.note_event(p_kind text, p_scope text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  select id into v_id from private.security_events
   where kind = p_kind and detail ->> 'scope' = p_scope and at > now() - interval '15 minutes'
   order by at desc limit 1;
  if v_id is null then
    insert into private.security_events (kind, detail) values (p_kind, jsonb_build_object('scope', p_scope, 'count', 1));
  else
    update private.security_events
       set detail = jsonb_set(detail, '{count}', to_jsonb(coalesce((detail ->> 'count')::int, 1) + 1))
     where id = v_id;
  end if;
end;
$$;
revoke all on function private.note_event(text, text) from public, anon, authenticated;
revoke all on function private.note_pin_lock() from public, anon, authenticated;

-- 1ב. חסימה של הגבלת הקצב (אותה פונקציה כמו 052, ועוד רישום) ------------------------------
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
  -- רק הסוג (plate, training, staff-ai...) ואם זו התקרה המשותפת. לא הכתובת המגובבת.
  if v_hits = p_max + 1 then
    perform private.note_event('rate_limited',
      split_part(p_key, ':', 1) || case when p_key like '%:all' then ':all' else '' end);
  end if;
  return v_hits <= p_max;
end;
$$;

-- 1ג. תקרת בקשות החיבור מלאה (אותה פונקציה כמו 032, ועוד רישום) ----------------------------
create or replace function public.request_station()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open int;
  v_code text;
  v_secret text;
  i int := 0;
begin
  select count(*) into v_open from public.station_requests
   where approved_at is null and consumed_at is null and expires_at > now();
  if v_open >= 10 then
    perform private.note_event('station_requests_full', 'station');
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;

  loop
    v_code := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (
      select 1 from public.station_requests
       where code = v_code and consumed_at is null and expires_at > now()
    );
    i := i + 1;
    if i > 30 then
      return jsonb_build_object('ok', false, 'reason', 'busy');
    end if;
  end loop;

  v_secret := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.station_requests (secret_hash, code)
  values (encode(extensions.digest(v_secret, 'sha256'), 'hex'), v_code);
  return jsonb_build_object('ok', true, 'secret', v_secret, 'code', v_code);
end
$$;

-- 1ד. מה אבי ודניאל רואים ------------------------------------------------------------------
create or replace function public.security_alerts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    raise exception 'only a manager or the owner' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'day', (
      select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
        select kind, sum(coalesce((detail ->> 'count')::int, 1)) as n
          from private.security_events where at > now() - interval '24 hours' and kind <> 'housekeeping'
         group by kind
      ) d
    ),
    'month', (
      select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
        select kind, sum(coalesce((detail ->> 'count')::int, 1)) as n
          from private.security_events where at > now() - interval '30 days' and kind <> 'housekeeping'
         group by kind
      ) m
    ),
    'last_housekeeping', (
      select jsonb_build_object('at', at, 'report', detail) from private.security_events
       where kind = 'housekeeping' order by at desc limit 1
    )
  );
end;
$$;
revoke all on function public.security_alerts() from public, anon;
grant execute on function public.security_alerts() to authenticated;
