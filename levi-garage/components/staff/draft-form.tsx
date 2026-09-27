"use client"

import { useState } from "react"

import { sendFinding } from "@/app/(he)/staff/actions"
import type { PriceItem } from "@/components/staff/arrive-form"

// מסך התמחור של דניאל. זה הרגע היחיד שבו אדם עומד בין המודל לבין הלקוח.
//
// מ-27.9 המכונאי לא אומר מחיר. דניאל בוחר עבודה מהמחירון, ומה שהחוק דורש
// בהצעה (ס' 131–132: שני סוגי חלקים והבדל, שעות עבודה, אחריות) מתמלא לבד.
// אפשר לתקן כל שדה. המסד מסרב לשלוח הצעה חסרה, וההודעה כאן אומרת למה.

type Draft = {
  id: number
  title: string | null
  customer_text: string | null
  price_list_id: number | null
  price_original: number | null
  price_aftermarket: number | null
  labor_hours: number | null
  warranty_original: string | null
  warranty_aftermarket: string | null
  part_diff: string | null
  single_reason: string | null
  eta: string | null
  safety: boolean
}

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v))

export function DraftForm({
  jobId,
  draft,
  items,
  suggest,
  maxDiscount = 10,
}: {
  jobId: number
  draft: Draft
  items: PriceItem[]
  suggest?: string | null
  /** דניאל עד 10%, אבי עד 30% (רועי, 28.9). המסד אוכף שוב. */
  maxDiscount?: number
}) {
  const initial = draft.price_list_id ?? items.find((i) => i.code === suggest)?.id ?? null
  const [f, setF] = useState(() => {
    const it = items.find((i) => i.id === initial)
    return {
      price_list_id: str(initial),
      title: draft.title ?? it?.title ?? "",
      price_original: str(draft.price_original ?? it?.price_original),
      price_aftermarket: str(draft.price_aftermarket ?? it?.price_aftermarket),
      labor_hours: str(draft.labor_hours ?? it?.labor_hours),
      warranty_original: draft.warranty_original ?? it?.warranty_original ?? "",
      warranty_aftermarket: draft.warranty_aftermarket ?? it?.warranty_aftermarket ?? "",
      part_diff: draft.part_diff ?? it?.part_diff ?? "",
      single_reason: draft.single_reason ?? it?.single_reason ?? "",
      eta: draft.eta ?? "",
      message: draft.customer_text ?? "",
      safety: draft.safety,
      discount_pct: "0",
      discount_reason: "",
    }
  })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }))

  function pick(id: string) {
    const it = items.find((i) => String(i.id) === id)
    if (!it) return setF((prev) => ({ ...prev, price_list_id: "" }))
    setF((prev) => ({
      ...prev,
      price_list_id: id,
      title: it.title,
      price_original: str(it.price_original),
      price_aftermarket: str(it.price_aftermarket),
      labor_hours: str(it.labor_hours),
      warranty_original: it.warranty_original,
      warranty_aftermarket: it.warranty_aftermarket ?? "",
      part_diff: it.part_diff ?? "",
      single_reason: it.single_reason ?? "",
    }))
  }

  const two = f.price_aftermarket.trim() !== ""
  const pct = Number(f.discount_pct) || 0
  const after = (v: string) => (v.trim() === "" ? null : Math.round((Number(v) * (100 - pct)) / 100))
  const steps = [0, 5, 10, 15, 20, 25, 30].filter((n) => n <= maxDiscount)

  return (
    <form
      className="job-draft"
      action={async (formData) => {
        setSending(true)
        setError("")
        const res = await sendFinding(formData)
        setSending(false)
        if (!res.ok) setError(res.error)
      }}
    >
      <input type="hidden" name="finding_id" value={draft.id} />
      <input type="hidden" name="job_id" value={jobId} />

      <label htmlFor={`pl-${draft.id}`}>עבודה מהמחירון</label>
      <select id={`pl-${draft.id}`} name="price_list_id" value={f.price_list_id} onChange={(e) => pick(e.target.value)}>
        <option value="">— לבחור —</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>{i.title}</option>
        ))}
      </select>

      <div className="draft-grid">
        <label>
          <span>כותרת ללקוח</span>
          <input name="title" value={f.title} onChange={set("title")} />
        </label>
        <label>
          <span>שעות עבודה</span>
          <input name="labor_hours" value={f.labor_hours} onChange={set("labor_hours")} inputMode="decimal" dir="ltr" />
        </label>
        <label>
          <span>{two ? "חלק מקורי, כולל מע\"מ" : "מחיר, כולל מע\"מ"}</span>
          <input name="price_original" value={f.price_original} onChange={set("price_original")} inputMode="decimal" dir="ltr" />
        </label>
        <label>
          <span>אחריות{two ? " (מקורי)" : ""}</span>
          <input name="warranty_original" value={f.warranty_original} onChange={set("warranty_original")} />
        </label>
        <label>
          <span>חלק חלופי, כולל מע"מ</span>
          <input name="price_aftermarket" value={f.price_aftermarket} onChange={set("price_aftermarket")} inputMode="decimal" dir="ltr" placeholder="ריק = אין חלופה" />
        </label>
        <label>
          <span>אחריות (חלופי)</span>
          <input name="warranty_aftermarket" value={f.warranty_aftermarket} onChange={set("warranty_aftermarket")} disabled={!two} />
        </label>
      </div>

      {two ? (
        <label>
          <span>ההבדל בין הסוגים, במילים של הלקוח (חובה לפי ס' 131)</span>
          <textarea name="part_diff" rows={2} value={f.part_diff} onChange={set("part_diff")} />
        </label>
      ) : (
        <label>
          <span>למה אין חלופה (חובה לפי ס' 131)</span>
          <textarea name="single_reason" rows={2} value={f.single_reason} onChange={set("single_reason")} />
        </label>
      )}

      <div className="draft-grid">
        <label>
          <span>מתי יהיה מוכן אם מאשרים</span>
          <input name="eta" value={f.eta} onChange={set("eta")} placeholder="למשל היום ב-15:00" />
        </label>
        <label className="draft-check">
          <input type="checkbox" name="safety" checked={f.safety} onChange={(e) => setF((p) => ({ ...p, safety: e.target.checked }))} />
          <span>ליקוי בטיחותי (אם הלקוח ידחה — לדווח)</span>
        </label>
      </div>

      <div className="draft-discount">
        <label>
          <span>הנחה</span>
          <select name="discount_pct" value={f.discount_pct} onChange={set("discount_pct")}>
            {steps.map((n) => (
              <option key={n} value={n}>{n === 0 ? "בלי הנחה" : `${n}%`}</option>
            ))}
          </select>
        </label>
        {pct > 0 && (
          <label>
            <span>למה (נרשם)</span>
            <input name="discount_reason" value={f.discount_reason} onChange={set("discount_reason")} required placeholder="למשל: עיכוב שלנו, לקוח ותיק" />
          </label>
        )}
        {pct > 0 && (
          <p className="staff-meta">
            הלקוח יראה: {after(f.price_original)?.toLocaleString("he-IL")} ש&quot;ח
            {two ? ` (חלופי ${after(f.price_aftermarket)?.toLocaleString("he-IL")} ש"ח)` : ""}, במקום מחיר המחירון.
            {maxDiscount <= 10 ? " מעל 10% — רק אבי." : ""}
          </p>
        )}
      </div>

      <label htmlFor={`draft-${draft.id}`}>מה נמצא, במילים ללקוח</label>
      <textarea id={`draft-${draft.id}`} name="message" rows={4} value={f.message} onChange={set("message")} required />
      <p className="job-check">הנוסח נכתב מההקלטה של המכונאי. המחירים מהמחירון, לא מההקלטה. אפשר לתקן הכול.</p>

      {error && (
        <p className="staff-error" role="alert">
          {error}
        </p>
      )}

      <button className="btn" type="submit" disabled={sending || !f.message.trim()}>
        {sending ? "שולחים..." : "שליחה ללקוח בוואטסאפ"}
      </button>
    </form>
  )
}
