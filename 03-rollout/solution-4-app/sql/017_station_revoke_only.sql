-- 017: מנהל עבודה מבטל עמדה, ולא יותר מזה.
--
-- ב-016 מדיניות העדכון של stations פתחה כל עמודה, כולל token_hash. מנהל שמשנה
-- את ה-hash יכול היה "לצמד" מכשיר בלי שהצימוד נרשם (created_by, created_at).
-- האפליקציה צריכה רק את revoked_at, ולכן זה מה שמותר לעדכן.
revoke update on public.stations from anon, authenticated;
grant update (revoked_at) on public.stations to authenticated;
