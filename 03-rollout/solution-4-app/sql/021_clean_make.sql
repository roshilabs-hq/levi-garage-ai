-- 021: שם היצרן בלי המדינה (28.9).
--
-- מאגר משרד התחבורה כותב יצרן ומדינה יחד ("מיצובישי יפן", "סקודה צ'כיה").
-- הלקוח ודניאל אומרים "מיצובישי". השם נכנס משני מקומות — מהאתר (/api/plate)
-- ומתרחיש ה-Make של זימון התורים — ולכן מנקים במסד, בכניסה, ולא בכל מסך בנפרד.

create or replace function private.clean_make(p_make text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
    coalesce(p_make, ''),
    '\s+(יפן|קוריאה|קוריאה הדרומית|צ''כיה|גרמניה|צרפת|ארה"ב|ארצות הברית|ספרד|איטליה|סין|טורקיה|בריטניה|אנגליה|הודו|תאילנד|רומניה|שבדיה|הונגריה|מקסיקו|סלובקיה|בלגיה|אוסטריה|פולין|פורטוגל|הולנד|קנדה|ברזיל|דרום אפריקה|מרוקו|אינדונזיה|טייוואן|מלזיה|סלובניה|סרביה|רוסיה|ארגנטינה|פינלנד)$',
    ''
  )), '')
$$;

-- security definer: הטריגר רץ בזהות של מי שמכניס את השורה (דניאל), ולו אין
-- גישה לסכמה private. בלי זה קבלת רכב נשברה בייצור לכמה דקות ב-28.9 — הבדיקות
-- תפסו את זה (law-gate, intake-quote), ותוקן לפני שנכנס תור אמיתי.
create or replace function public.clean_vehicle_make()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.vehicle_make := private.clean_make(new.vehicle_make);
  return new;
end
$$;

revoke all on function public.clean_vehicle_make() from public, anon, authenticated;

drop trigger if exists bookings_clean_make on public.bookings;
create trigger bookings_clean_make before insert or update of vehicle_make on public.bookings
  for each row execute function public.clean_vehicle_make();

drop trigger if exists job_cards_clean_make on public.job_cards;
create trigger job_cards_clean_make before insert or update of vehicle_make on public.job_cards
  for each row execute function public.clean_vehicle_make();

-- מה שכבר נשמר.
update public.bookings set vehicle_make = private.clean_make(vehicle_make) where vehicle_make is distinct from private.clean_make(vehicle_make);
update public.job_cards set vehicle_make = private.clean_make(vehicle_make) where vehicle_make is distinct from private.clean_make(vehicle_make);
