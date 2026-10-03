import { NextResponse } from "next/server"

import { lookupPlate } from "@/lib/site/plate"

// בדיקת רכב לפי מספר רישוי. הלוגיקה ב-lib/site/plate.ts, כדי שגם הקבלה בדלפק תשתמש בה.
export const maxDuration = 45

export async function GET(req: Request) {
  const r = await lookupPlate(new URL(req.url).searchParams.get("n") ?? "")
  if ("error" in r) return NextResponse.json(r, { status: r.error === "invalid" ? 400 : 502 })
  return NextResponse.json(r)
}
