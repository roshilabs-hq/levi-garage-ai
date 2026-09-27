-- סגירת הרשאות שהקוד התכוון אליהן ולא קיבל (27.9.2026).
--
-- מה נמצא: כל קובץ SQL כאן עושה "revoke all ... from public" ואז נותן הרשאה
-- למי שצריך. אבל ב-Supabase פונקציה חדשה ב-public מקבלת הרשאת הרצה ישירה
-- ל-anon ול-authenticated (default privileges), וה-revoke מ-public לא נוגע בה.
-- התוצאה: שלוש פונקציות שנועדו לצוות מחובר בלבד היו פתוחות גם לאורח.
--
-- למה זה לא היה ניתן לניצול: כל אחת בודקת בפנים את auth.uid() מול טבלת
-- הצוות, ולאורח אין auth.uid(). send_finding זורקת 42501, set_my_lift זורקת
-- 42501, ו-lobby_view מחזירה אפס שורות. כלומר נשארה שכבה אחת במקום שתיים.
--
-- מה לא נוגעים בו, בכוונה:
--   approval_*, fleet_view, garage_customer, intake_booking, claim_due_reminders,
--   finish_reminder — "דלתות צרות" שנועדו לאורח, ובודקות טוקן או סוד משותף.
--   is_staff, is_worker, my_role — נקראות מתוך מדיניות RLS. אם ל-anon לא תהיה
--   הרשאה להריץ אותן, כל שאילתה של אורח על טבלה מוגנת תיכשל בשגיאה במקום
--   להחזיר אפס שורות.

-- 1. הגדרות פרטיות: RLS בלי מדיניות = אף אחד חוץ מהבעלים (postgres).
--    כל מי שקורא מהטבלה (intake_booking, garage_customer, set_garage_bot_token,
--    ו-bot_secret_ok דרך פונקציות security definer) רץ כבעלים, ובעלים עוקף RLS
--    כשאין force. ראו sql/002, שנכתב ולא הורץ עד היום.
alter table private.settings enable row level security;

-- 2. שלוש הפונקציות של הצוות.
revoke execute on function public.send_finding(bigint, text, text) from anon;
revoke execute on function public.set_my_lift(smallint) from anon;
revoke execute on function public.lobby_view() from anon;

-- 3. שלא יחזור: פונקציה חדשה ב-public לא תקבל יותר הרשאת הרצה לאורח מעצמה.
--    כל קובץ כאן ממילא נותן הרשאות במפורש, אז שום דבר קיים לא משתנה.
alter default privileges for role postgres in schema public revoke execute on functions from anon;
