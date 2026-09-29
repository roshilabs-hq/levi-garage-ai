-- 025: המסכים מתעדכנים לבד (רועי, 29.9, בהרצה הראשונה שלו).
--
-- "כל לחיצה אצל אלכס מצריכה רענון אצל דניאל. דניאל לא צריך לנחש שמשהו נשלח אליו."
--
-- איך: כל כתיבה לטבלאות העבודה מעדכנת שורה אחת בטבלה קטנה, live_ticks, שבה יש רק
-- שם טבלה ושעה. הדפדפן מאזין לטבלה הזו ב-Supabase Realtime, וכשהיא זזה, הוא מושך
-- את הדף מחדש מהשרת, עם ההרשאות הרגילות של המשתמש.
--
-- למה לא להאזין ישר ל-findings ול-job_cards: Realtime שולח את השורה עצמה. למכונאי
-- חסומות עמודות (מחירים שהלקוח עוד לא אישר), והשידור היה עוקף את החסימה, גם אם
-- המסך לא מציג אותן. ב-live_ticks אין מה לחשוף.

create table if not exists public.live_ticks (
  topic text primary key,
  at timestamptz not null default now()
);

alter table public.live_ticks enable row level security;
revoke all on public.live_ticks from anon, authenticated;
grant select on public.live_ticks to authenticated;

-- כל משתמש פעיל, כולל מסך חדר ההמתנה: יש כאן רק "משהו השתנה", ושעה.
drop policy if exists live_ticks_read on public.live_ticks;
create policy live_ticks_read on public.live_ticks
  for select to authenticated
  using (exists (select 1 from public.staff s where s.id = (select auth.uid()) and s.active));

create or replace function private.tick_live()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.live_ticks (topic, at) values (tg_table_name, now())
  on conflict (topic) do update set at = excluded.at;
  return null;
end;
$$;

-- פעם אחת לכל פקודה (for each statement), לא לכל שורה.
do $$
declare
  t text;
begin
  foreach t in array array['job_cards', 'findings', 'help_calls', 'approvals', 'bookings', 'inspections', 'media', 'quote_items'] loop
    execute format('drop trigger if exists live_tick on public.%I', t);
    execute format('create trigger live_tick after insert or update or delete on public.%I for each statement execute function private.tick_live()', t);
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_ticks'
  ) then
    alter publication supabase_realtime add table public.live_ticks;
  end if;
end;
$$;
