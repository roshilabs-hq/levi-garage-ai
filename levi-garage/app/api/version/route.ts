import { NextResponse } from "next/server"

// איזו גרסה ואיזו בנייה רצות עכשיו בשרת. ראו next.config.mjs, CHANGELOG.md
// ו-components/staff/auto-refresh.tsx.
export const dynamic = "force-dynamic"

export function GET() {
  return NextResponse.json({ version: process.env.APP_VERSION ?? "", build: process.env.APP_BUILD ?? "" }, { headers: { "cache-control": "no-store" } })
}
