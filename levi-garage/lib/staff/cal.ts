// 3.10: רכב שהגיע לפני מועד התור שלו ונמסר. המועד המקורי מתפנה ביומן של
// Cal.com, כדי שלקוח אחר יוכל לקבוע בו. הביטול חוזר אלינו דרך Make, והמסד לא
// נותן לו לבטל רכב שכבר התקבל (039). המפתח (CAL_SITE_KEY) ייעודי, בלי תפוגה.
//
// Cal.com שולח ללקוח מייל ביטול, ולא ניתן לכבות אותו מה-API. לכן זה קורה
// במסירה ולא בקבלה (רועי), והסיבה כתובה אליו: הרכב כבר נמסר, ואין מה לעשות.

const REASON = "הרכב שלך כבר טופל ונמסר, ולכן המועד המקורי שנקבע לו התפנה. אין צורך לעשות דבר."

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

/** מועד התור עוד לא הגיע? רק אז יש מה לפנות. מועד שעבר — אין מקום לשחרר, ואין סיבה למייל. */
export function isUpcoming(dropOffIso: string | null, now = new Date()): boolean {
  if (!dropOffIso) return false
  return new Date(dropOffIso).getTime() > now.getTime()
}
