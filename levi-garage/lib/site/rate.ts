import "server-only"

import { createHash, createHmac } from "node:crypto"
import { headers } from "next/headers"

// 047: הגבלת קצב משותפת לכל שרתי Vercel (rate_hit במסד). עד היום כל שרת ספר
// לחוד בזיכרון, והמונה התאפס בכל הפעלה קרה. כאן נספר במסד, לפי כתובת IP
// מגובבת (לא שומרים את הכתובת עצמה), או לפי מזהה הלקוח של הבוט.
//
// אם המסד לא עונה, מאשרים: עדיף שאתר יעבוד משפגיעה קלה בהגנה מפני הצפה.

// IPv6: כל ספק נותן ללקוח רשת /64 שלמה, ואפשר להחליף כתובת בכל בקשה. לכן סופרים לפי
// 4 הקבוצות הראשונות (בדיקת האבטחה המסכמת, 6.10, M-2).
function ipOf(forwarded: string | null | undefined): string {
  const ip = forwarded?.split(",")[0]?.trim() || "local"
  return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") : ip
}
const hashed = (prefix: string, ip: string) => `${prefix}:${createHash("sha256").update(ip).digest("hex").slice(0, 24)}`

export function ipKey(req: Request, prefix: string): string {
  return hashed(prefix, ipOf(req.headers.get("x-forwarded-for")))
}

/** אותו מפתח, מתוך פעולת שרת (שם אין Request, רק headers()). */
export async function ipKeyFromHeaders(prefix: string): Promise<string> {
  const h = await headers()
  return hashed(prefix, ipOf(h.get("x-forwarded-for")))
}

// הסוד נגזר מ-STATION_SECRET, שכבר נמצא בשרת (HMAC עם תווית משלו), ולכן לא צריך משתנה חדש
// ב-Vercel. גזירה חד-כיוונית: מי שמשיג את הנגזר לא מגיע ממנו ל-STATION_SECRET. במסד נשמר רק
// הגיבוב של הנגזר (rate_rpc_hash). RATE_LIMIT_SECRET, אם יוגדר, גובר, למשל לסיבוב בלי לגעת בעמדות.
function rateSecret(): string | undefined {
  if (process.env.RATE_LIMIT_SECRET) return process.env.RATE_LIMIT_SECRET
  const s = process.env.STATION_SECRET
  return s && s.length >= 32 ? createHmac("sha256", s).update("rate-limit-v1").digest("base64url") : undefined
}

export async function allowed(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  // 052 (ביקורת אבטחה חיצונית, 7.10, ממצא 4): המסד סופר רק עם הסוד של השרת. בלעדיו כל אחד עם
  // המפתח הציבורי יכול היה למלא את המונים או לשרוף את התקרה היומית של הבוטים.
  const secret = rateSecret()
  if (!url || !anon) return true
  try {
    const res = await fetch(`${url}/rest/v1/rpc/rate_hit`, {
      method: "POST",
      headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" },
      body: JSON.stringify({ p_key: key.slice(0, 120), p_window_seconds: windowSeconds, p_max: max, ...(secret ? { p_secret: secret } : {}) }),
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    })
    if (!res.ok) return true
    return (await res.json()) !== false
  } catch {
    return true
  }
}
