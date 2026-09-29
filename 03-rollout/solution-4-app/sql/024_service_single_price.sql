-- 024: טיפול תקופתי במחיר אחד (רועי, 29.9, בהרצה הראשונה שלו מהקבלה ועד המסירה).
--
-- ההצעה הראשונה ללקוח, זו שנפתחת בקבלת הרכב, הציגה בטיפול קטן שתי אפשרויות:
-- "מקורי 650 / חלופי 450", והסבר על ההבדל. בטיפול זה לא רלוונטי. הלקוח בא לטיפול,
-- לא לבחור מסנן. המחיר אחד, והוא המחיר שכבר מופיע באתר (450 ו-1,200, "החל מ-").
--
-- סעיף 131 עדיין מתקיים: שורה בלי חלק חלופי חייבת הסבר (single_reason), והשער
-- ב-send_finding בודק את זה. ההסבר כתוב כמו שאומרים אותו ללקוח, ולא "למה אין חלופה".

update public.price_list
   set price_original = 450,
       price_aftermarket = null,
       warranty_aftermarket = null,
       part_diff = null,
       single_reason = 'מחיר אחד לטיפול: שמן ומסנן בתקן שיצרן הרכב דורש.'
 where code = 'service-small';

update public.price_list
   set price_original = 1200,
       price_aftermarket = null,
       warranty_aftermarket = null,
       part_diff = null,
       single_reason = 'מחיר אחד לטיפול: שמן, מסננים ונוזלים בתקן שיצרן הרכב דורש.'
 where code = 'service-big';
