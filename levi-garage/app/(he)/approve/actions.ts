"use server"

import { createClient } from "@/lib/supabase/server"
import { quoteEmail, type QuoteSnapshot } from "@/lib/staff/quote"
import { sendEmail } from "@/lib/staff/email"

// ההכרעה של הלקוח, מהקישור. הלקוח לא מחובר: הטוקן הוא המפתח, והמסד בודק אותו
// (approval_decide). אחרי ההכרעה ההצעה הראשונה מתעדכנת ונשלחת אליו במייל —
// ס' 132(ב): עדכון באמצעי אלקטרוני, ואז "לעדכן בהקדם את הצעת המחיר הראשונה".

export async function decideApproval(token: string, decision: "approved" | "declined", choice: "original" | "aftermarket" | null) {
  if (!/^[0-9a-f]{36}$/.test(token) || (decision !== "approved" && decision !== "declined")) return { ok: false as const }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("approval_decide", {
    p_token: token,
    p_decision: decision,
    p_part_choice: decision === "approved" ? choice : null,
  })
  if (error || data === "unavailable") return { ok: false as const }

  // המייל לא מעכב את התשובה ללקוח אם הוא נכשל: ההכרעה כבר נשמרה בכתב.
  try {
    const { data: v } = await supabase.rpc("quote_update_for_token", { p_token: token })
    if (v) {
      const version = v as { id: number; version: number; email: string; snapshot: QuoteSnapshot }
      const sent = await sendEmail(version.email, quoteEmail(version.snapshot, version.version, "update"))
      await supabase.rpc("finish_quote_update", {
        p_token: token,
        p_id: version.id,
        p_status: sent.ok ? "sent" : "failed",
        p_error: sent.ok ? null : `${sent.reason}${!sent.ok && sent.detail ? `: ${sent.detail}` : ""}`,
      })
    }
  } catch (e) {
    console.error("quote update email failed:", (e as Error).message)
  }

  return { ok: true as const }
}
