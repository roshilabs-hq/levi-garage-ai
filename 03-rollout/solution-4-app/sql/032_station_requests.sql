-- 032: "חיבור הפוך" של עמדה (החלטה של רועי, 2.10: "2 נראה לי מצוין").
--
-- עד היום, כדי לחבר טאבלט לליפט, דניאל יצר קוד QR על המסך שלו, והטאבלט היה צריך
-- לסרוק אותו. אם הצימוד נופל באמצע יום, מישהו רץ עם הטאבלט לדלפק. עכשיו ההפך:
-- הטאבלט שליד הליפט מבקש ("לבקש מדניאל לחבר"), מציג קוד קצר (למשל 4821), ובלוח של
-- דניאל מופיע "מכשיר 4821 מבקש להיות עמדה" — הוא בוחר ליפט ומאשר. אף אחד לא זז.
--
-- האבטחה:
--   * הטאבלט מחזיק סוד אקראי (32 תווים) בעוגייה httpOnly; במסד רק ה-hash שלו.
--     הקוד הקצר הוא רק להשוואה בעין, לא מפתח.
--   * רק מנהל עבודה או הבעלים, מחוברים, מאשרים — ובוחרים לאיזה ליפט.
--   * בקשה פגה תוך 15 דקות; עד 10 בקשות פתוחות בבת אחת, כדי שאי אפשר להציף את הלוח.
--   * גם אחרי אישור, המכשיר הוא עמדה ולא משתמש: עדיין צריך שם וקוד של מכונאי.
--   * צימוד ב-QR (022) נשאר כגיבוי.
--
-- בלי "drop ... if exists": הטבלה חדשה, וה-MCP של Supabase מסווג drop כהרסני
-- ומבקש אישור שלא מגיע מהשליטה מרחוק (ראו 031).

create table if not exists public.station_requests (
  id uuid primary key default gen_random_uuid(),
  secret_hash text not null unique,
  code text not null check (code ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  approved_at timestamptz,
  approved_by uuid references public.staff (id),
  lift smallint check (lift between 1 and 4),
  label text,
  consumed_at timestamptz,
  station_id uuid references public.stations (id) on delete set null
);

create index if not exists station_requests_pending_idx on public.station_requests (created_at)
  where approved_at is null and consumed_at is null;

-- אין קריאה ואין כתיבה ישירה לאף אחד: רק דרך הפונקציות.
alter table public.station_requests enable row level security;
revoke all on public.station_requests from anon, authenticated;

-- הטאבלט: בקשה חדשה. מחזיר את הסוד (פעם אחת) ואת הקוד הקצר להצגה.
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

-- הטאבלט בודק כל כמה שניות. כשדניאל אישר: נוצרת עמדה, והטוקן שלה חוזר פעם אחת.
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
  if v_row.approved_at is null then
    if v_row.expires_at <= now() then
      return jsonb_build_object('status', 'expired');
    end if;
    return jsonb_build_object('status', 'pending', 'code', v_row.code);
  end if;
  -- אושר, אבל אף אחד לא אסף את זה רבע שעה: לא נותנים עמדה מאוחר מדי.
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

-- דניאל: הבקשות שמחכות לו.
create or replace function public.open_station_requests()
returns table (id uuid, code text, created_at timestamptz, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    return;
  end if;
  return query
    select r.id, r.code, r.created_at, r.expires_at from public.station_requests r
     where r.approved_at is null and r.consumed_at is null and r.expires_at > now()
     order by r.created_at;
end
$$;

-- דניאל מאשר: לאיזה ליפט (ריק = עמדת האבחון).
create or replace function public.approve_station_request(p_id uuid, p_lift smallint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can approve a station' using errcode = '42501';
  end if;
  if p_lift is not null and p_lift not between 1 and 4 then
    raise exception 'a lift is 1 to 4, or none for the diagnosis bay' using errcode = '22023';
  end if;
  update public.station_requests
     set approved_at = now(), approved_by = (select auth.uid()), lift = p_lift,
         label = case when p_lift is null then 'עמדת האבחון' else 'ליפט ' || p_lift end
   where id = p_id and approved_at is null and consumed_at is null and expires_at > now();
  if not found then
    return 'gone';
  end if;
  return 'ok';
end
$$;

-- הלוח של דניאל מתרענן לבד כשמכשיר מבקש (025).
create trigger live_tick after insert or update on public.station_requests
  for each statement execute function private.tick_live();

revoke all on function public.request_station() from public;
grant execute on function public.request_station() to anon, authenticated;
revoke all on function public.station_request_status(text) from public;
grant execute on function public.station_request_status(text) to anon, authenticated;
revoke all on function public.open_station_requests() from public, anon;
grant execute on function public.open_station_requests() to authenticated;
revoke all on function public.approve_station_request(uuid, smallint) from public, anon;
grant execute on function public.approve_station_request(uuid, smallint) to authenticated;
