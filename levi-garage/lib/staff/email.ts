import "server-only"

// שליחת מייל דרך Resend. משמש להצעת המחיר (ס' 132(ב): הצעה ראשונה "במסמך
// מודפס או בהודעת דואר אלקטרוני"), ולעדכון שלה אחרי כל תשובה של הלקוח.
//
// בלי מפתח זה לא נופל: מחזיר not_configured, והקבלה ממשיכה עם ההצעה המודפסת.
// המפתח ב-RESEND_API_KEY, והשולח ב-QUOTE_FROM (למשל "מוסך לוי ובניו <quotes@roshilabs.app>").

export type EmailResult = { ok: true; id: string } | { ok: false; reason: "not_configured" | "bad_address" | "failed"; detail?: string }

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function sendEmail(to: string | null | undefined, msg: { subject: string; html: string; text: string }): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.QUOTE_FROM
  if (!key || !from) return { ok: false, reason: "not_configured" }
  if (!to || !EMAIL.test(to)) return { ok: false, reason: "bad_address" }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: msg.subject, html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(15000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body?.id) return { ok: false, reason: "failed", detail: `${res.status} ${body?.message ?? ""}`.trim() }
    return { ok: true, id: body.id }
  } catch (e) {
    return { ok: false, reason: "failed", detail: (e as Error).message }
  }
}
