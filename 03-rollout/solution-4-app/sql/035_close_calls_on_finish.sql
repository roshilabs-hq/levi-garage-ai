-- 035: רכב שיצא מהעבודה לא נשאר ב"קוראים לך" (סבב 2.10).
--
-- בלוח של דניאל נשארה "גמור, מחכה לבדיקה שלך" על רכב שכבר נמסר: הקריאה נפתחה
-- ב-14:18, הרכב נמסר ב-14:24, והקריאה נשארה פתוחה. בקוד (setJobStatus) כבר נסגרות
-- קריאות כשהרכב מוכן/נמסר/בוטל, אבל רק דרך הכפתור הזה. כאן זה עובר למסד: כל
-- דרך שמעבירה כרטיס לאחד המצבים האלה סוגרת את הקריאות הפתוחות שלו.

create or replace function private.close_calls_on_finish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('ready', 'delivered', 'cancelled') and old.status is distinct from new.status then
    update public.help_calls
       set resolved_at = now(), resolved_by = coalesce((select auth.uid()), resolved_by)
     where job_card_id = new.id and resolved_at is null;
  end if;
  return null;
end
$$;

create trigger job_cards_close_calls after update of status on public.job_cards
  for each row execute function private.close_calls_on_finish();

-- מה שכבר נתקע: קריאות פתוחות על רכבים שכבר יצאו מהעבודה.
update public.help_calls h
   set resolved_at = now()
  from public.job_cards j
 where j.id = h.job_card_id and h.resolved_at is null and j.status in ('ready', 'delivered', 'cancelled');
