"use server"

import { createClient } from "@/lib/supabase/server"
import { quoteEmail, type QuoteSnapshot } from "@/lib/staff/quote"
import { sendEmail } from "@/lib/staff/email"

// ההכרעה של הלקוח, מהקישור. הלקוח לא מחובר: הטוקן הוא המפתח, והמסד בודק אותו.
// אחרי ההכרעה ההצעה הראשונה מתעדכנת ונשלחת אליו במייל — ס' 132(ב): עדכון באמצעי
// אלקטרוני, ואז "לעדכן בהקדם את הצעת המחיר הראשונה".

const TOKEN = /^[0-9a-f]{36}$/

/** קישור ישן, לפני 027: ממצא אחד בקישור. */
export async function decideApproval(token: string, decision: "approved" | "declined", choice: "original" | "aftermarket" | null) {
  if (!TOKEN.test(token) || (decision !== "approved" && decision !== "declined")) return { ok: false as const }

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

type Decision = { finding_id: number; decision: "approved" | "declined"; part_choice: "original" | "aftermarket" | null }

/** 027: כל הממצאים בקישור, בשליחה אחת. ומייל מעודכן אחד. */
export async function decideRequest(token: string, decisions: Decision[]) {
  if (!TOKEN.test(token) || !Array.isArray(decisions) || decisions.length === 0 || decisions.length > 30) return { ok: false as const }
  const clean = decisions.map((d) => ({
    finding_id: Number(d.finding_id),
    decision: d.decision === "approved" ? "approved" : "declined",
    part_choice: d.decision === "approved" ? (d.part_choice === "aftermarket" ? "aftermarket" : "original") : null,
  }))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("request_decide", { p_token: token, p_decisions: clean })
  if (error || data !== "done") return { ok: false as const }

  try {
    const { data: v } = await supabase.rpc("quote_update_for_request", { p_token: token })
    if (v) {
      const version = v as { id: number; version: number; email: string; snapshot: QuoteSnapshot }
      const sent = await sendEmail(version.email, quoteEmail(version.snapshot, version.version, "update"))
      await supabase.rpc("finish_request_update", {
        p_token: token,
        p_id: version.id,
        p_status: sent.ok ? "sent" : "failed",
        p_error: sent.ok ? null : `${sent.reason}${!sent.ok && sent.detail ? `: ${sent.detail}` : ""}`,
      })
    }
  } catch (e) {
    console.error("request update email failed:", (e as Error).message)
  }
  return { ok: true as const }
}
