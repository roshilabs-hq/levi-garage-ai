// 3.10: הסכמה לעדכונים בוואטסאפ, במילים של הלקוח.
//
// הסימון בטופס של Cal.com הפך לרשות. מי שלא סימן יכול לכתוב לנו את ההודעה
// הכתובה מראש ("אשמח לקבל תזכורת ועדכון"), מדף "התור נקבע" או מה-QR שבדלפק.
// ההודעה היא ההסכמה: מפורשת, מהמספר שלו, ונשמרת אצלו בשיחה. /api/ask מזהה
// אותה ומעדכן את התור והכרטיס שלו (039, grant_whatsapp_consent).

import { dicts } from "@/lib/site/dict"

/** ההודעה שהלקוח שולח מה-QR בדלפק, כשהגיע בלי תור או בלי הסכמה. */
export const COUNTER_MESSAGE = "שלום, אני במוסך עכשיו 🙂 אשמח לקבל בוואטסאפ את הצעת המחיר ועדכונים על הרכב"

// הלב של כל הודעה, בלי האימוג'י והפתיחה, כדי שגם עריכה קלה של הלקוח תיתפס.
const PHRASES = [
  "אשמח לקבל תזכורת",
  "אשמח לקבל בוואטסאפ",
  "אשמח לקבל עדכונים",
  "أرجو تذكيري",
  "Пришлите, пожалуйста, напоминание",
]

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()

export function asksForUpdates(text: string): boolean {
  const t = norm(text)
  return PHRASES.some((p) => t.includes(norm(p)))
}

// שומר שההודעות הכתובות מראש באתר אכן נתפסות. אם מישהו ישנה נוסח ב-dict,
// הבדיקה (scripts/test-round3.mjs) תיפול.
export const PREFILLED = [dicts.he.book.waMessage, dicts.ar.book.waMessage, dicts.ru.book.waMessage, COUNTER_MESSAGE]
