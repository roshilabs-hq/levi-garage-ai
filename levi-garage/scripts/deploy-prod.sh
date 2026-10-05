#!/usr/bin/env bash
# 5.10.2026: הסקריפט הזה כבר לא פורס.
#
# האתר עבר לפרויקט ב-Vercel של החשבון העסקי (roshilabs-hq), שמחובר למאגר
# roshilabs-hq/levi-garage-ai ב-GitHub. כל דחיפה ל-main פורסת לבד, בלי CLI ובלי
# התחברות מהמחשב הזה. עד 5.10 כל פריסה יצאה מכאן ידנית, וכל פעם שההתחברות של
# ה-CLI פגה, הפריסה נעצרה.
#
# לפרוס: git push ל-main. לבדוק שעלה: curl https://levi-garage.co.il/api/version
# הפרויקט הישן (roi-roshinovic-s-projects/levi-garage) נשאר כגיבוי, בלי הדומיין.
echo "הפריסה אוטומטית: כל דחיפה ל-main ב-roshilabs-hq/levi-garage-ai פורסת את האתר."
echo "אחרי הדחיפה: curl https://levi-garage.co.il/api/version"
exit 1
