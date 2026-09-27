// "מה המצב של הרכב שלי?" — מי כותב לבוט, ומה הרכבים שלו.
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
const JOB_STATE: Record<string, string> = {
  open: "הגיע אלינו ומחכה לליפט",
  in_progress: "בעבודה אצלנו עכשיו",
  waiting_quote: "המכונאי סיים לבדוק, והצעת מחיר תישלח בוואטסאפ בקרוב",
  waiting_approval: "מחכה לאישור: נשלח בוואטסאפ קישור עם מה שמצאנו והמחיר, ושם מאשרים או דוחים",
  ready: "מוכן לאיסוף. אפשר לאסוף א׳–ה׳ עד 17:00, ו׳ עד 12:00",
  delivered: "נמסר",
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
      const state = JOB_STATE[c.status] ?? "אצלנו במוסך"
      const eta = c.eta && c.status !== "ready" && c.status !== "delivered" ? ` זמן מוכן משוער: ${c.eta}.` : ""
      return `- ${car}: ${state}.${eta}`
    })
    .join("\n")
}
