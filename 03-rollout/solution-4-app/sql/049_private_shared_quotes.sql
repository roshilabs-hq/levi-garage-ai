-- 049: התמונות של דף האישור נסגרות יחד עם הקישור (בדיקת ציות, 4.10, פער 1).
-- עד היום הדלי shared-quotes היה ציבורי: מי ששמר את כתובת התמונה ראה אותה גם אחרי
-- שהקישור פג. מדיניות הפרטיות מבטיחה שהקישור פג אחרי שבוע, ולכן גם התמונות.
--
-- מעכשיו: הדלי פרטי. דף האישור מבקש כתובת חתומה לשעה, והמסד נותן אותה רק כשהתיקייה
-- (הטוקן של האישור) שייכת לאישור שעוד בתוקף. אחרי שפג, גם כתובת ישנה לא נפתחת.
--
-- סדר ההחלה (כמו ב-043): 1. הפונקציה והמדיניות (לא שובר כלום, הדלי עוד ציבורי),
-- 2. פריסה של הדף עם הכתובות החתומות, 3. רק אז הדלי לפרטי (בסוף הקובץ).

-- 1. האם התיקייה הזו שייכת לאישור שעוד בתוקף. מחזירה רק כן/לא; הטוקן הוא 36 תווים
--    אקראיים, וממילא אין דרך לנחש אותו.
create or replace function public.shared_photo_open(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.approvals a
    where a.token = p_folder
      and (a.expires_at is null or a.expires_at > now())
  )
$$;

revoke all on function public.shared_photo_open(text) from public;
grant execute on function public.shared_photo_open(text) to anon, authenticated;

-- רק חתימה של קובץ שהשם שלו ידוע. בלי allow_any_operation, אותה מדיניות SELECT
-- נותנת גם לרשום את תוכן הדלי, וכך לגלות טוקנים של אישורים פתוחים. זה קרה בהחלה
-- הראשונה (049a, דקות ספורות, נתפס בבדיקה shared-photos.mjs) ותוקן ב-049b.
create policy shared_quotes_open_link_read on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'shared-quotes'
    and storage.allow_any_operation(array['storage.object.sign', 'storage.object.sign_many'])
    and public.shared_photo_open((storage.foldername(name))[1])
  );

-- 3. אחרי הפריסה:
update storage.buckets set public = false where id = 'shared-quotes';
