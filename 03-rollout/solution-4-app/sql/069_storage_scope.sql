-- 069: סקירת OWASP Top 10:2025 (8.10, A01 בקרת גישה): קובצי האחסון לפי אותה הרשאה כמו שורות המדיה.
--
-- 062 צמצמה את מה שמכונאי רואה בטבלאות: רכב פעיל, או שנמסר ב-24 השעות האחרונות. אבל מדיניות
-- האחסון של job-media נשארה "כל איש צוות קורא הכול": מכונאי שנכנס בסיסמה יכול היה לרשום את כל
-- התיקיות ולהוריד תמונות של רכבים שנמסרו לפני שבועות (נבדק ב-8.10 בשם מכונאי: רשימה והורדה של
-- תמונות מרכב שנמסר תשעה ימים קודם). שורות המדיה היו מוסתרות, הקבצים עצמם לא.
--
-- הנתיב של כל קובץ מתחיל ב-job-<מזהה הכרטיס>/ (voice, finding-photo). עכשיו:
--   · קריאה: איש צוות, ורק מתיקייה של רכב שהוא רואה (can_see_job).
--   · כתיבה: עובד, ורק לתיקייה של רכב שמותר לו לגעת בו (can_touch_job). עד היום מכונאי יכול היה
--     להעלות קובץ לתיקייה של כל רכב (השורה ב-media הייתה נחסמת, הקובץ לא).
--   · קובץ מחוץ לתיקיית job-<id> (אין כאלה בייצור): רק בעלים ומנהל עבודה, כי לשניהם can_see_job
--     ו-can_touch_job מחזירות true גם בלי כרטיס.
-- המחיקה של קובץ יתום (056) לא משתנה. בלי drop.

alter policy job_media_staff_read on storage.objects
  using (
    bucket_id = 'job-media'
    and public.is_staff()
    and public.can_see_job(
      case when split_part(name, '/', 1) ~ '^job-[0-9]{1,12}$' then substr(split_part(name, '/', 1), 5)::bigint end
    )
  );

alter policy job_media_staff_write on storage.objects
  with check (
    bucket_id = 'job-media'
    and public.is_worker()
    and public.can_touch_job(
      case when split_part(name, '/', 1) ~ '^job-[0-9]{1,12}$' then substr(split_part(name, '/', 1), 5)::bigint end
    )
  );
