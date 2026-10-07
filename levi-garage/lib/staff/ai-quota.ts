import "server-only"

import { allowed } from "@/lib/site/rate"

// תמלול, ניתוח הקלטה והמוסכניק הוותיק: כל קריאה כאן היא Gemini (ביקורת אבטחה חיצונית, 7.10, ממצא 7).
// עד היום אלה היו הנתיבים היחידים שעולים כסף בלי מכסה. מכשיר שנשאר מחובר בעמדה, או משתמש שמנסה
// להציף, היה מריץ קריאות בלי הגבלה.
//   · 60 בשעה לכל איש צוות: מכונאי עמוס מקליט אולי 15 ממצאים ביום.
//   · 2,000 ביום לכל הצוות יחד: תקרה לחשבון, גם אם כמה משתמשים נפרצו בבת אחת.
export async function staffAiAllowed(staffId: string): Promise<boolean> {
  if (!(await allowed(`staff-ai:${staffId}`, 3600, 60))) return false
  return allowed("staff-ai:all", 86400, 2000)
}
