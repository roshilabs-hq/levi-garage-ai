-- 068: מהביקורת השישית (8.10, 78/100): ממצאים 1, 2 ו-4.
--
-- 1 (גבוה). 067 הקפיאה את פריטי הצעת הקבלה רק אחרי שהלקוח אישר. אבל דף הלקוח קורא את הפריטים
--    החיים, ולכן מחיר שהשתנה בין השליחה לאישור היה נרשם כאילו הלקוח אישר אותו. עכשיו הפריטים קפואים
--    מרגע שנשלח קישור לאישור (quote_requests מסוג intake), ובוודאי אחרי אישור או חתימה. האפליקציה
--    כותבת את הפריטים רק בקבלת הרכב, לפני השליחה, ולכן אין זרימה שנפגעת. מה שהלקוח רואה הוא מה
--    שהוא מאשר.
-- 2. bind_station_session חידשה את created_at כשהכניסה כבר הייתה רשומה. כך אפשר היה להאריך את ה-12
--    שעות של המשמרת (066) בלי להקיש קוד. עכשיו כניסה נרשמת פעם אחת, בלי חידוש. כניסה חדשה (שם וקוד
--    בעמדה) היא תמיד סשן חדש.
-- 4. מדיה חדשה חייבת "נוצר על ידי" = המשתמש עצמו. לא ריק.
-- בלי drop.

-- 1 ---------------------------------------------------------------------------------------------
create or replace function private.quote_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_jobs bigint[] := case
    when tg_op = 'DELETE' then array[old.job_card_id]
    when tg_op = 'UPDATE' then array[old.job_card_id, new.job_card_id]
    else array[new.job_card_id] end;
begin
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if exists (select 1 from public.job_cards j where j.id = any (v_jobs) and j.work_approved_at is not null) then
    raise exception 'the customer already approved this quote' using errcode = '22023', hint = 'quote-locked';
  end if;
  if exists (select 1 from public.quote_requests r where r.job_card_id = any (v_jobs) and r.kind = 'intake') then
    raise exception 'the quote was already sent to the customer' using errcode = '22023', hint = 'quote-locked';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- 2 ---------------------------------------------------------------------------------------------
create or replace function public.bind_station_session(p_token text)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid uuid := private.my_session_id();
  v_station public.stations%rowtype;
  v_existing public.station_sessions%rowtype;
begin
  if v_sid is null or not exists (
    select 1 from public.staff s where s.id = (select auth.uid()) and s.active and s.role = 'mechanic'
  ) then
    raise exception 'only a mechanic signs in at a station' using errcode = '42501', hint = 'station-session';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    raise exception 'not a station' using errcode = '42501', hint = 'station-session';
  end if;
  select * into v_station from public.stations
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if not found then
    raise exception 'not a station' using errcode = '42501', hint = 'station-session';
  end if;

  -- כניסה נרשמת פעם אחת. בלי חידוש ובלי מעבר לעמדה אחרת: כניסה חדשה היא סשן חדש (068).
  select * into v_existing from public.station_sessions where session_id = v_sid;
  if found then
    if v_existing.station_id <> v_station.id or v_existing.staff_id <> (select auth.uid()) then
      raise exception 'this sign-in already belongs to another station' using errcode = '42501', hint = 'station-session';
    end if;
    return v_existing.lift;
  end if;

  insert into public.station_sessions (session_id, staff_id, station_id, lift)
  values (v_sid, (select auth.uid()), v_station.id, v_station.lift);
  return v_station.lift;
end;
$$;

-- 4 ---------------------------------------------------------------------------------------------
alter policy media_staff_write on public.media
  with check (
    public.can_touch_job(job_card_id)
    and created_by = (select auth.uid())
    and (finding_id is null or exists (select 1 from public.findings f where f.id = media.finding_id and f.job_card_id = media.job_card_id))
  );
