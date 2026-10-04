"use client"

import { useState } from "react"

import { cancelDiscountRequest, requestDiscount } from "@/app/(he)/staff/actions"

// 4.10 (ההרצה של רועי): הנחה מעל 10% היא של אבי, ועד היום הדרך היחידה הייתה
// להתקשר אליו. עכשיו דניאל מבקש מכאן, עם אחוז וסיבה. אבי רואה את הבקשה בסרגל
// העליון ובלוח היום, ומאשר או דוחה בלחיצה (042). עד שהוא עונה, הממצא לא נשלח.
// הסיבה פנימית: הלקוח לא רואה אותה, רק את האחוז והמחיר.

export function DiscountAsk({
  jobId,
  findingId,
  pending,
}: {
  jobId: number
  findingId: number
  pending: { pct: number; reason: string | null } | null
}) {
  const [pct, setPct] = useState("20")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function run(action: typeof requestDiscount, extra: Record<string, string> = {}) {
    setBusy(true)
    setError("")
    const fd = new FormData()
    fd.set("finding_id", String(findingId))
    fd.set("job_id", String(jobId))
    for (const [k, v] of Object.entries(extra)) fd.set(k, v)
    const res = await action(fd)
    setBusy(false)
    if (!res.ok) setError(res.error)
  }

  if (pending) {
    return (
      <div className="discount-ask waiting" role="status">
        <p>
          ⏳ <b>מחכה לאבי: הנחה של {pending.pct}%</b>
          {pending.reason ? ` · ${pending.reason}` : ""}. עד שהוא עונה, הממצא הזה לא נשלח ללקוח.
        </p>
        <button className="btn quiet" type="button" disabled={busy} onClick={() => run(cancelDiscountRequest)}>
          לבטל את הבקשה
        </button>
        {error && <p className="staff-error">{error}</p>}
      </div>
    )
  }

  return (
    <details className="discount-ask">
      <summary>צריך יותר מ-10%? לבקש מאבי</summary>
      <div className="discount-ask-row">
        <label>
          <span>כמה</span>
          <select value={pct} onChange={(e) => setPct(e.target.value)}>
            {[15, 20, 25, 30].map((n) => (
              <option key={n} value={n}>{n}%</option>
            ))}
          </select>
        </label>
        <label>
          <span>למה (נרשם, הלקוח לא רואה)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: לקוח ותיק, עיכוב שלנו" />
        </label>
        <button className="btn" type="button" disabled={busy || reason.trim() === ""} onClick={() => run(requestDiscount, { pct, reason })}>
          {busy ? "שולחים..." : "לשלוח לאבי"}
        </button>
      </div>
      <p className="staff-meta">אבי יראה את הבקשה בלוח היום שלו ויאשר או ידחה. כשהוא מאשר, ההנחה נכנסת לממצא לבד.</p>
      {error && <p className="staff-error">{error}</p>}
    </details>
  )
}
