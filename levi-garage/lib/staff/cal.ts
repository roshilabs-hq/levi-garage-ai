// 3.10: רכב שהתקבל ביום אחר מיום התור שלו. המקום ביומן של Cal.com מתפנה, כדי
// שלקוח אחר יוכל לקבוע בו. הביטול חוזר אלינו דרך Make, והמסד לא נותן לו לבטל
// רכב שכבר התקבל (039). המפתח (CAL_SITE_KEY) הוא מפתח ייעודי בלי תאריך תפוגה.
//
// Cal.com שולח ללקוח מייל ביטול, ולא ניתן לכבות אותו מה-API. לכן הסיבה כתובה
// אליו, והיא מופיעה במייל: הרכב כבר אצלנו, ואין צורך לעשות דבר.

const REASON = "הרכב שלך כבר התקבל במוסך, לפני מועד התור, ולכן המועד המקורי התפנה. אין צורך לעשות דבר."

export async function releaseCalSlot(uid: string): Promise<boolean> {
  const key = process.env.CAL_SITE_KEY
  // רכב בלי תור מקבל מזהה משלנו (walkin-...), ואין לו מה לפנות ב-Cal.com.
  if (!key || !uid || uid.startsWith("walkin-")) return false
  try {
    const res = await fetch(`https://api.cal.com/v2/bookings/${encodeURIComponent(uid)}/cancel`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "cal-api-version": "2024-08-13" },
      body: JSON.stringify({ cancellationReason: REASON }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error("cal release failed:", res.status)
    return res.ok
  } catch (e) {
    console.error("cal release failed:", (e as Error).message)
    return false
  }
}

const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" })

/** התור ליום אחר מהיום (שעון ישראל)? רק אז מפנים את המקום. באותו יום, בשעה אחרת, לא נוגעים. */
export function isOtherDay(dropOffIso: string | null, now = new Date()): boolean {
  if (!dropOffIso) return false
  return day.format(new Date(dropOffIso)) !== day.format(now)
}
