import { NextResponse } from "next/server"

import { sendDueNudges } from "@/lib/staff/notify"

// נקרא מ-pg_cron במסד כל 5 דקות (019): תזכורת ללקוח שלא ענה על קישור לאישור
// תוך 30 דקות. ב-Vercel בחבילה החינמית משימה מתוזמנת רצה פעם ביום, ולכן השעון
// יושב במסד. הדלת: אותו טוקן משותף שהמסד והבוט כבר מחזיקים.
export async function POST(req: Request) {
  const secret = process.env.GARAGE_BOT_TOKEN
  if (!secret || req.headers.get("x-garage-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  return NextResponse.json(await sendDueNudges())
}
