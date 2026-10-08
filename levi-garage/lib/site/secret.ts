import { timingSafeEqual } from "node:crypto"

// השוואת סוד בזמן קבוע, במקום אחד (סקירת OWASP, 8.10, A04). עד היום הבוט ו-nudges השוו כך, ושתי
// משימות ה-cron השוו עם !==, שזמן הריצה שלו תלוי במספר התווים הנכונים. כל דלת שמקבלת סוד בכותרת
// עוברת כאן: בלי סוד בשרת, או בלי ערך בבקשה, הדלת סגורה.
export function sameSecret(sent: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !sent) return false
  const a = Buffer.from(sent)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** כותרת Authorization: Bearer <סוד>, כמו ש-Vercel שולח למשימות המתוזמנות. */
export function bearerOk(req: Request, secret: string | undefined): boolean {
  const header = req.headers.get("authorization") ?? ""
  return header.startsWith("Bearer ") && sameSecret(header.slice(7), secret)
}
