-- 022: צימוד עמדה בקוד QR (28.9).
--
-- עד היום, כדי להפוך טלפון או טאבלט לעמדה, דניאל היה צריך להתחבר עליו עם
-- הסיסמה שלו. במוסך זה לא נוח, ולבוחן עם מחשב אחד וטלפון אחד זה מבלבל.
-- עכשיו: דניאל בוחר ליפט במחשב, מופיע קוד QR, סורקים בטלפון — והטלפון עמדה.
--
-- האבטחה: הקוד הוא 32 תווים אקראיים, במסד נשמר רק ה-hash שלו, הוא תקף 10 דקות
-- ופעם אחת בלבד. מי שמצליח לממש אותו מקבל עמדה, לא משתמש: עדיין צריך שם וקוד
-- של מכונאי כדי להיכנס, ודניאל רואה את העמדה ברשימה ויכול לבטל אותה.

create table if not exists public.station_pair_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text not null,
  lift smallint check (lift between 1 and 4),
  created_by uuid not null references public.staff (id) on delete cascade,  -- קוד זמני, בלי משמעות בלי מי שיצר אותו
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz,
  station_id uuid references public.stations (id) on delete set null
);

-- אין קריאה ואין כתיבה ישירה לאף אחד: רק דרך שתי הפונקציות.
alter table public.station_pair_codes enable row level security;
revoke all on public.station_pair_codes from anon, authenticated;

-- דניאל: קוד חדש לליפט. קוד קודם שלא נוצל לאותו ליפט מתבטל, כדי שלא יסתובבו
-- כמה קודים תקפים במקביל.
create or replace function public.create_pair_code(p_lift smallint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_label text;
begin
  if public.my_role() is null or public.my_role() not in ('owner', 'manager') then
    raise exception 'only a manager or the owner can pair a station' using errcode = '42501';
  end if;
  if p_lift is not null and p_lift not between 1 and 4 then
    raise exception 'a lift is 1 to 4, or none for the diagnosis bay' using errcode = '22023';
  end if;
  v_label := case when p_lift is null then 'עמדת האבחון' else 'ליפט ' || p_lift end;

  update public.station_pair_codes set expires_at = now()
   where used_at is null and expires_at > now() and lift is not distinct from p_lift;

  v_code := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.station_pair_codes (code_hash, label, lift, created_by)
  values (encode(extensions.digest(v_code, 'sha256'), 'hex'), v_label, p_lift, (select auth.uid()));
  return v_code;
end
$$;

-- הטלפון: מממש את הקוד ומקבל טוקן של עמדה (כמו create_station). פעם אחת.
create or replace function public.redeem_pair_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.station_pair_codes%rowtype;
  v_token text;
  v_station uuid;
begin
  if p_code is null or p_code !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;

  select * into v_row from public.station_pair_codes
   where code_hash = encode(extensions.digest(p_code, 'sha256'), 'hex')
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  if v_row.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.stations (label, lift, token_hash, created_by)
  values (v_row.label, v_row.lift, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_row.created_by)
  returning id into v_station;

  update public.station_pair_codes set used_at = now(), station_id = v_station where id = v_row.id;
  return jsonb_build_object('ok', true, 'token', v_token, 'label', v_row.label);
end
$$;

-- מה הקוד עומד לעשות, בלי לממש אותו: הטלפון מראה "לצמד את המכשיר הזה לליפט 1?"
-- לפני הלחיצה. מקדימי קישורים (וואטסאפ, סורקים) פותחים את הכתובת בלי ללחוץ,
-- ולכן המימוש הוא רק בלחיצה.
create or replace function public.pair_code_info(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_code is null or p_code !~ '^[0-9a-f]{32}$' then jsonb_build_object('ok', false, 'reason', 'bad')
    else coalesce((
      select case
        when c.used_at is not null then jsonb_build_object('ok', false, 'reason', 'used')
        when c.expires_at <= now() then jsonb_build_object('ok', false, 'reason', 'expired')
        else jsonb_build_object('ok', true, 'label', c.label, 'expires_at', c.expires_at)
      end
      from public.station_pair_codes c
      where c.code_hash = encode(extensions.digest(p_code, 'sha256'), 'hex')
    ), jsonb_build_object('ok', false, 'reason', 'bad'))
  end
$$;

revoke all on function public.create_pair_code(smallint) from public, anon;
grant execute on function public.create_pair_code(smallint) to authenticated;
revoke all on function public.redeem_pair_code(text) from public;
grant execute on function public.redeem_pair_code(text) to anon, authenticated;
revoke all on function public.pair_code_info(text) from public;
grant execute on function public.pair_code_info(text) to anon, authenticated;
