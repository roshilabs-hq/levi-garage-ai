-- 059: מכונאי עובד על ליפט רק מכניסה בעמדה (ביקורת שלישית, 8.10: מה שנשאר אחרי 057).
--
-- 057 קשרה את הליפט לכניסה בעמדה. כניסה של מכונאי בלי עמדה (מייל וסיסמה, למשל בטלפון) המשיכה לקחת
-- את הליפט מהשורה של העובד, כלומר מהעמדה האחרונה שבה נכנס. מי שהשיג את הסיסמה של מכונאי יכול היה
-- לפעול על הרכב שעל הליפט שלו בלי לעמוד שם.
-- עכשיו: למכונאי בלי עמדה אין ליפט. הוא רואה ונוגע רק ברכבים שעוד לא על ליפט (תור, אבחון, חניה),
-- כמו מכונאי בעמדת האבחון. כדי לעבוד על ליפט נכנסים בעמדה שלו. למנהל ולבעלים זה לא משנה (051).

create or replace function public.my_lift()
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when b.session_id is not null then b.lift
           when s.role = 'mechanic' then null
           else s.lift
         end
    from public.staff s
    left join public.station_sessions b on b.session_id = private.my_session_id() and b.staff_id = s.id
   where s.id = (select auth.uid()) and s.active
$$;
