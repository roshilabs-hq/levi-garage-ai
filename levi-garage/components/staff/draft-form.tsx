"use client"

import { useEffect, useRef, useState } from "react"

import { saveFinding } from "@/app/(he)/staff/actions"
import { DiscountAsk } from "@/components/staff/discount-ask"
import type { PriceItem } from "@/components/staff/arrive-form"

// ממצא אחד במסך התמחור של דניאל (027). זה הרגע היחיד שבו אדם עומד בין המודל לבין הלקוח.
//
// דניאל בוחר עבודה מהמחירון, וכל מה שהחוק דורש בהצעה (ס' 131–132: סוגי חלקים והבדל,
// שעות, אחריות) מתמלא ונשמר מיד. השורה מציגה סיכום; השדות עצמם נפתחים רק כשצריך
// לתקן משהו (רועי, 30.9: "יש שם בלאגן"). השליחה עצמה היא אחת, לכל הממצאים, למטה.

export type Draft = {
  id: number
  title: string | null
  customer_text: string | null
  price_list_id: number | null
  /** 030: כמות. המחירים במסד הם הסכום הכולל. */
  quantity?: number | null
  price_original: number | null
  price_aftermarket: number | null
  list_price_original: number | null
  list_price_aftermarket: number | null
  discount_pct: number | null
  discount_reason: string | null
  /** 042: בקשה פתוחה לאבי, אם יש. */
  discount_request_pct?: number | null
  discount_request_reason?: string | null
  discount_request_at?: string | null
  labor_hours: number | null
  warranty_original: string | null
  warranty_aftermarket: string | null
  part_diff: string | null
  single_reason: string | null
  eta: string | null
  safety: boolean
}

type Fields = {
  price_list_id: string
  /** כמה יחידות (צמיגים, מגבים). המחירים והשעות שעל המסך הם ליחידה. */
  quantity: string
  title: string
  price_original: string
  price_aftermarket: string
  labor_hours: string
  warranty_original: string
  warranty_aftermarket: string
  part_diff: string
  single_reason: string
  eta: string
  message: string
  safety: boolean
  discount_pct: string
  discount_reason: string
}

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v))

/** "2 × החלפת צמיג" ← "החלפת צמיג". הכותרת במסד כוללת את הכמות (030). */
const baseTitle = (t: string) => t.replace(/^\d+\s*×\s*/, "")

const hoursOf = (h: string, qty: number) => (h.trim() === "" ? h : String(Math.round(Number(h) * qty * 100) / 100))

/**
 * מה שנשמר: מחירים ושעות כפול הכמות, וכותרת "2 × ...", כדי שהלקוח, המייל וחוקי
 * ס' 132 יקבלו סכום סופי בלי לדעת על כמויות.
 */
function totalsOf(f: Fields): Fields {
  const q = Math.max(1, Number(f.quantity) || 1)
  if (q === 1) return { ...f, title: baseTitle(f.title) }
  const times = (v: string) => (v.trim() === "" ? v : String(Math.round(Number(v) * q * 100) / 100))
  return {
    ...f,
    title: `${q} × ${baseTitle(f.title).replace(/\s*\((אחד|אחת)\)/, "")}`,
    price_original: times(f.price_original),
    price_aftermarket: times(f.price_aftermarket),
    labor_hours: times(f.labor_hours),
  }
}
const money = (v: string) => (v.trim() === "" ? "" : `${Number(v).toLocaleString("he-IL")} ש"ח`)

/** מה עוד חסר כדי שמותר לשלוח (אותם כללים כמו במסד). ריק = מוכן. */
export function missingOf(f: Fields): string[] {
  const out: string[] = []
  if (f.price_original.trim() === "") out.push("מחיר")
  if (f.labor_hours.trim() === "") out.push("שעות עבודה")
  if (f.warranty_original.trim() === "") out.push("אחריות")
  if (f.price_aftermarket.trim() !== "") {
    if (f.warranty_aftermarket.trim() === "") out.push("אחריות לחלופי")
    if (f.part_diff.trim() === "") out.push("ההבדל בין הסוגים")
  } else if (f.single_reason.trim() === "") out.push("למה אין חלופה")
  if (f.message.trim() === "") out.push("נוסח ללקוח")
  if (Number(f.discount_pct) > 0 && f.discount_reason.trim() === "") out.push("סיבה להנחה")
  return out
}

export function DraftForm({
  jobId,
  draft,
  items,
  suggest,
  maxDiscount = 10,
  onState,
}: {
  jobId: number
  draft: Draft
  items: PriceItem[]
  suggest?: string | null
  /** דניאל עד 10%, אבי עד 30% (רועי, 28.9). המסד אוכף שוב. */
  maxDiscount?: number
  /** מדווח למעלה: מוכן לשליחה? יש שינויים שלא נשמרו? */
  onState?: (s: { ready: boolean; dirty: boolean }) => void
}) {
  const initial = draft.price_list_id ?? items.find((i) => i.code === suggest)?.id ?? null
  const [f, setF] = useState<Fields>(() => {
    const it = items.find((i) => i.id === initial)
    // מחירי המחירון, לא אחרי ההנחה: ההנחה מחושבת מהם במסד בכל שמירה.
    const qty = Math.max(1, Number(draft.quantity ?? 1) || 1)
    const unit = (v: number | null | undefined) =>
      v === null || v === undefined ? v : Math.round((Number(v) / qty) * 100) / 100
    const po = unit(draft.list_price_original ?? draft.price_original)
    const pa = unit(draft.list_price_original !== null ? draft.list_price_aftermarket : draft.price_aftermarket)
    return {
      price_list_id: str(initial),
      quantity: String(qty),
      title: baseTitle(draft.title ?? it?.title ?? ""),
      price_original: str(po ?? it?.price_original),
      price_aftermarket: str(po !== null && po !== undefined ? pa : it?.price_aftermarket),
      labor_hours: str(unit(draft.labor_hours) ?? it?.labor_hours),
      warranty_original: draft.warranty_original ?? it?.warranty_original ?? "",
      warranty_aftermarket: draft.warranty_aftermarket ?? it?.warranty_aftermarket ?? "",
      part_diff: draft.part_diff ?? it?.part_diff ?? "",
      single_reason: draft.single_reason ?? it?.single_reason ?? "",
      eta: draft.eta ?? "",
      message: draft.customer_text ?? "",
      safety: draft.safety,
      discount_pct: str(draft.discount_pct ?? 0),
      discount_reason: draft.discount_reason ?? "",
    }
  })
  // המצב האחרון שנשמר במסד. "יש שינויים" = מה שעל המסך שונה ממנו.
  // מה שעל המסך בטעינה הוא מה שבמסד. טיוטה שקיבלה הצעה מהמחירון (לפי פריט האבחון)
  // נשמרת לבד פעם אחת, למטה.
  const [saved, setSaved] = useState<string>(() => JSON.stringify(f))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)
  const autoSaved = useRef(false)

  // 042: כשאבי מאשר הנחה, היא נכתבת במסד והדף מתרענן. ההנחה החדשה נכנסת לטופס
  // ולמצב השמור, כדי ששמירה הבאה של דניאל לא תחזיר את האחוז הישן.
  useEffect(() => {
    const pct = str(draft.discount_pct ?? 0)
    const reason = draft.discount_reason ?? ""
    setF((p) => (p.discount_pct === pct && p.discount_reason === reason ? p : { ...p, discount_pct: pct, discount_reason: reason }))
    setSaved((prev) => {
      const o = JSON.parse(prev) as Fields
      return o.discount_pct === pct && o.discount_reason === reason ? prev : JSON.stringify({ ...o, discount_pct: pct, discount_reason: reason })
    })
  }, [draft.discount_pct, draft.discount_reason])

  const dirty = JSON.stringify(f) !== saved
  const missing = missingOf(f)
  const ready = missing.length === 0 && !dirty

  useEffect(() => {
    onState?.({ ready, dirty })
  }, [ready, dirty, onState])

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }))

  async function save(next: Fields = f) {
    setBusy(true)
    setError("")
    const fd = new FormData()
    fd.set("finding_id", String(draft.id))
    fd.set("job_id", String(jobId))
    for (const [k, v] of Object.entries(totalsOf(next))) {
      if (k === "safety") {
        if (v) fd.set("safety", "on")
      } else fd.set(k, String(v))
    }
    const res = await saveFinding(fd)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setSaved(JSON.stringify(next))
  }

  function pick(id: string) {
    const it = items.find((i) => String(i.id) === id)
    if (!it) return setF((prev) => ({ ...prev, price_list_id: "" }))
    const next: Fields = {
      ...f,
      price_list_id: id,
      title: f.title.trim() ? f.title : it.title,
      price_original: str(it.price_original),
      price_aftermarket: str(it.price_aftermarket),
      labor_hours: str(it.labor_hours),
      warranty_original: it.warranty_original,
      warranty_aftermarket: it.warranty_aftermarket ?? "",
      part_diff: it.part_diff ?? "",
      single_reason: it.single_reason ?? "",
    }
    setF(next)
    // בחירה מהמחירון נשמרת מיד: זה כל מה שרוב הממצאים צריכים.
    void save(next)
  }

  function setQty(n: number) {
    const q = String(Math.min(20, Math.max(1, n)))
    if (q === f.quantity) return
    const next = { ...f, quantity: q }
    setF(next)
    void save(next)
  }

  // טיוטה שהגיעה עם הצעה מהמחירון (לפי פריט האבחון) ועוד לא נשמרה: נשמרת לבד פעם אחת.
  useEffect(() => {
    if (autoSaved.current || draft.price_original !== null || !initial) return
    autoSaved.current = true
    void save()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const two = f.price_aftermarket.trim() !== ""
  const pct = Number(f.discount_pct) || 0
  const qty = Math.max(1, Number(f.quantity) || 1)
  const after = (v: string) =>
    v.trim() === "" ? "" : money(String(Math.round((Number(v) * qty * (100 - pct)) / 100)))
  const times = qty > 1 ? `${qty} × · ` : ""
  // 4.10 (רועי: "המחירים לא מתעדכנים"): השדות שומרים את מחיר המחירון, וההנחה
  // מחושבת ממנו במסד (020). כשיש הנחה, השם של השדה אומר את זה, ומתחתיו המחיר
  // שהלקוח יראה, ליחידה.
  const listNote = pct > 0 ? " (מחירון, לפני הנחה)" : ""
  const unitAfter = (v: string) =>
    pct > 0 && v.trim() !== "" ? (
      <small className="draft-after" aria-live="polite">אחרי הנחה {pct}%: {money(String(Math.round((Number(v) * (100 - pct)) / 100)))}</small>
    ) : null
  // ההנחה הנוכחית תמיד ברשימה, גם כשאבי אישר יותר ממה שדניאל יכול לתת לבד.
  const steps = [0, 5, 10, 15, 20, 25, 30].filter((n) => n <= maxDiscount || n === pct)

  return (
    <div className="draft">
      <div className="draft-row">
        <select
          aria-label="עבודה מהמחירון"
          value={f.price_list_id}
          onChange={(e) => pick(e.target.value)}
          disabled={busy}
        >
          <option value="">— עבודה מהמחירון —</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>{i.title}</option>
          ))}
        </select>
        <span className="draft-qty" role="group" aria-label="כמות">
          <button type="button" className="btn quiet" onClick={() => setQty(qty - 1)} disabled={busy || qty <= 1} aria-label="פחות">
            −
          </button>
          <b className="num" aria-live="polite">{qty}</b>
          <button type="button" className="btn quiet" onClick={() => setQty(qty + 1)} disabled={busy || qty >= 20} aria-label="עוד אחד">
            +
          </button>
        </span>
        <span className={`draft-sum ${missing.length ? "missing" : ""}`}>
          {f.price_original.trim() === ""
            ? "עוד לא תומחר"
            : two
              ? `${times}מקורי ${after(f.price_original)} · חלופי ${after(f.price_aftermarket)} · ${hoursOf(f.labor_hours, qty)} שע׳`
              : `${times}${after(f.price_original)} · ${hoursOf(f.labor_hours, qty)} שע׳ · אחריות ${f.warranty_original || "?"}`}
          {pct > 0 ? ` · הנחה ${pct}%` : ""}
        </span>
      </div>

      <label className="draft-msg">
        <span>מה נמצא, במילים ללקוח</span>
        <textarea rows={3} value={f.message} onChange={set("message")} />
      </label>

      <details className="draft-more" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>פרטים: כותרת, מחירים, אחריות, הנחה</summary>
        <div className="draft-grid">
          <label>
            <span>כותרת ללקוח</span>
            <input value={f.title} onChange={set("title")} />
          </label>
          <label>
            <span>שעות עבודה{qty > 1 ? ", ליחידה" : ""}</span>
            <input value={f.labor_hours} onChange={set("labor_hours")} inputMode="decimal" dir="ltr" />
          </label>
          <label>
            <span>{two ? "חלק מקורי, כולל מע\"מ" : "מחיר, כולל מע\"מ"}{qty > 1 ? ", ליחידה" : ""}{listNote}</span>
            <input value={f.price_original} onChange={set("price_original")} inputMode="decimal" dir="ltr" />
            {unitAfter(f.price_original)}
          </label>
          <label>
            <span>אחריות{two ? " (מקורי)" : ""}</span>
            <input value={f.warranty_original} onChange={set("warranty_original")} />
          </label>
          <label>
            <span>חלק חלופי, כולל מע"מ{qty > 1 ? ", ליחידה" : ""}{listNote}</span>
            <input value={f.price_aftermarket} onChange={set("price_aftermarket")} inputMode="decimal" dir="ltr" placeholder="ריק = אין חלופה" />
            {unitAfter(f.price_aftermarket)}
          </label>
          <label>
            <span>אחריות (חלופי)</span>
            <input value={f.warranty_aftermarket} onChange={set("warranty_aftermarket")} disabled={!two} />
          </label>
        </div>
        <label>
          <span>{two ? "ההבדל בין הסוגים, במילים של הלקוח (חובה לפי ס' 131)" : "הסבר ללקוח כשיש מחיר אחד (חובה לפי ס' 131)"}</span>
          <textarea rows={2} value={two ? f.part_diff : f.single_reason} onChange={set(two ? "part_diff" : "single_reason")} />
        </label>
        <div className="draft-grid">
          <label>
            <span>מתי יהיה מוכן אם מאשרים</span>
            <input value={f.eta} onChange={set("eta")} placeholder="למשל היום ב-15:00" />
          </label>
          <label className="draft-check">
            <input type="checkbox" checked={f.safety} onChange={(e) => setF((p) => ({ ...p, safety: e.target.checked }))} />
            <span>ליקוי בטיחותי (אם הלקוח ידחה, לדווח)</span>
          </label>
          <label>
            <span>הנחה</span>
            <select value={f.discount_pct} onChange={set("discount_pct")}>
              {steps.map((n) => (
                <option key={n} value={n}>{n === 0 ? "בלי הנחה" : `${n}%`}</option>
              ))}
            </select>
          </label>
          {pct > 0 && (
            <label>
              <span>למה ההנחה (נרשם)</span>
              <input value={f.discount_reason} onChange={set("discount_reason")} placeholder="למשל: עיכוב שלנו, לקוח ותיק" />
            </label>
          )}
        </div>
        {maxDiscount <= 10 && (
          <DiscountAsk
            jobId={jobId}
            findingId={draft.id}
            pending={draft.discount_request_at ? { pct: Number(draft.discount_request_pct), reason: draft.discount_request_reason ?? null } : null}
          />
        )}
      </details>

      <div className="draft-foot">
        {dirty && (
          <button className="btn" type="button" onClick={() => save()} disabled={busy}>
            {busy ? "שומרים..." : "לשמור"}
          </button>
        )}
        <span className={`staff-meta ${missing.length ? "draft-missing" : ""}`} role="status">
          {busy ? "שומרים..." : missing.length ? `חסר: ${missing.join(", ")}` : dirty ? "יש שינויים שלא נשמרו" : "✓ מוכן לשליחה"}
        </span>
      </div>
      {error && (
        <p className="staff-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
