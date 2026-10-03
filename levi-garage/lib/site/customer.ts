// "מה המצב של הרכב שלי?" — מי כותב לבוט, ומה הרכבים שלו.

import { pickupPhrase } from "@/lib/hours"
//
// הבוט שולח מזהה אטום של השולח (HMAC של המספר). המסד מחשב את אותו מזהה על
// הטלפונים שבתורים ובכרטיסים, ומחזיר רק את הרכבים של מי שכותב (sql/003 של
// פתרון 3). האתר לא מקבל מספר טלפון בשום שלב.

export type CustomerCar = {
  kind: "job" | "booking"
  name: string | null
  car: string | null
  plate_tail: string
  status: string
  since?: string | null
  ready_at?: string | null
  eta?: string | null
  drop_off_at?: string | null
}

/** הרכבים של השולח, או רשימה ריקה. לעולם לא זורק: בלי הקשר, העוזר עונה כרגיל. */
export async function customerCars(client: string): Promise<CustomerCar[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const token = process.env.GARAGE_BOT_TOKEN
  if (!url || !key || !token || !/^wa-[0-9a-f]{16}$/.test(client)) return []

  try {
    const res = await fetch(`${url}/rest/v1/rpc/garage_customer`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_secret: token, p_client: client }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    })
    if (!res.ok) return []
    const rows = await res.json()
    return Array.isArray(rows) ? (rows as CustomerCar[]) : []
  } catch {
    return []
  }
}

/**
 * 3.10: הלקוח כתב "אשמח לקבל עדכונים" (lib/site/consent.ts). מסמן הסכמה בתור
 * ובכרטיס שלו. מחזיר כמה שורות השתנו; לעולם לא זורק.
 */
export async function grantConsent(client: string): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const token = process.env.GARAGE_BOT_TOKEN
  if (!url || !key || !token || !/^wa-[0-9a-f]{16}$/.test(client)) return 0
  try {
    const res = await fetch(`${url}/rest/v1/rpc/grant_whatsapp_consent`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_secret: token, p_client: client }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    })
    if (!res.ok) return 0
    const n = await res.json()
    return typeof n === "number" ? n : 0
  } catch {
    return 0
  }
}

const when = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  weekday: "long",
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

// בלי לשון זכר: המגדר של הלקוח לא ידוע, ו-Gemini מעתיק את הלשון של העובדות.
// עד 27.9 היה כתוב כאן "יש לו תור" ו"הוא יקבל", והלקוחה קיבלה "תקבל".
// מבחינת הלקוח יש שלב אחד, "בעבודה", מרגע שהרכב התקבל ועד שנשלח אליו מחיר
// לאישור (החלטה של רועי, 27.9). מחכה לליפט, על הליפט, המכונאי כותב ממצא — זה
// המטבח של המוסך, והלקוח לא צריך לדעת עליו. גם מסך חדר ההמתנה מראה כך.
const WORKING = "בעבודה אצלנו עכשיו"
const JOB_STATE: Record<string, string> = {
  open: WORKING,
  in_progress: WORKING,
  waiting_quote: WORKING,
  waiting_approval: "מחכה לאישור: נשלח בוואטסאפ קישור עם מה שמצאנו והמחיר, ושם מאשרים או דוחים",
  // 036–037: התקבל בדלפק, וההצעה לעבודה מחכה לאישור של הלקוח. עד אז לא מתחילים, גם לא אבחון.
  waiting_intake:
    "התקבל במוסך, ומחכה לאישור של הצעת המחיר: נשלח קישור בוואטסאפ ובמייל, ושם מאשרים. מתחילים לעבוד על הרכב רק אחרי האישור",
  // "מוכן" ו"נמסר" מחושבים ב-describeCars, לפי השעה (סבב 2.10, ממצאים 17–18).
}

/** איך קוראים לרכב, תמיד באותו ניסוח: "מיצובישי אאוטלנדר (מספר רישוי שמסתיים ב-311)". */
export function carLabel(c: Pick<CustomerCar, "car" | "plate_tail">): string {
  const tail = c.plate_tail ? `מספר רישוי שמסתיים ב-${c.plate_tail}` : ""
  if (c.car && tail) return `${c.car} (${tail})`
  return c.car || (tail ? `הרכב (${tail})` : "הרכב")
}

/**
 * השם הפרטי של השולח, מהתור או מהכרטיס הראשון שיש בו שם.
 * השם הוקלד על ידי הלקוח בטופס, והוא נכנס להנחיות של Gemini — ולכן רק אותיות
 * (כל שפה), מקף וגרש, עד 20 תווים. "התעלם מההוראות" לא עובר את הסינון הזה.
 */
export function firstName(cars: CustomerCar[]): string | null {
  const raw = cars.find((c) => c.name)?.name ?? ""
  const clean = raw.normalize("NFC").replace(/[^\p{L}\p{M}'\-]/gu, "").slice(0, 20)
  return clean.length >= 2 ? clean : null
}

/**
 * העובדות על הרכבים של השולח, בעברית פשוטה, כדי ש-Gemini יענה עליהן בכל
 * ניסוח ובכל אחת משלוש השפות. רק מה שכתוב כאן — בלי מחירים ובלי אבחון.
 */
export function describeCars(cars: CustomerCar[]): string {
  return cars
    .map((c) => {
      const car = carLabel(c)
      if (c.kind === "booking") {
        const at = c.drop_off_at ? when.format(new Date(c.drop_off_at)) : "מועד לא ידוע"
        return `- ${car}: יש תור לטיפול ברכב, מסירה ב${at}. התור נקלט במערכת. יום לפני תישלח תזכורת בוואטסאפ.`
      }
      // "נמסר" לבד הפך אצל Gemini ל"נמסר למוסך" (2.10), כלומר ההפך. העובדה צריכה
      // להיות חד-משמעית: הרכב כבר אצל הלקוח, ומתי. ו"מוכן" אומר מתי אפשר לבוא בפועל,
      // לא שעות פתיחה כלליות: בשישי אחרי 12:00 זה "ביום ראשון, מ-07:00".
      const state =
        c.status === "ready"
          ? `מוכן לאיסוף. ${pickupPhrase()}`
          : c.status === "delivered"
            ? `כבר נאסף מהמוסך${c.since ? `, ב${when.format(new Date(c.since))}` : ""}. הרכב אצל הלקוח, לא אצלנו`
            : (JOB_STATE[c.status] ?? "אצלנו במוסך")
      const eta = c.eta && c.status !== "ready" && c.status !== "delivered" ? ` זמן מוכן משוער: ${c.eta}.` : ""
      return `- ${car}: ${state}.${eta}`
    })
    .join("\n")
}
