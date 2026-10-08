import { NextResponse } from "next/server"

import { sendDueReminders } from "@/lib/staff/notify"
import { bearerOk } from "@/lib/site/secret"

// המשימה היומית של Vercel (vercel.json): תזכורת בוואטסאפ לכל מי שיש לו תור
// מחר. Vercel שולח את CRON_SECRET בכותרת; בלעדיו, או בלי המשתנה, הדלת סגורה.
// ההשוואה בזמן קבוע (סקירת OWASP, 8.10).
export async function GET(req: Request) {
  if (!bearerOk(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  return NextResponse.json(await sendDueReminders())
}
