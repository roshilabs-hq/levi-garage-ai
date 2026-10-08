"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { decideRequest } from "@/app/(he)/approve/actions"

// דף האישור של הלקוח כשיש כמה ממצאים (027). לכל ממצא: איזה חלק, או "לא מאשר/ת".
// שליחה אחת לכולם. ההכרעה נשמרת דרך השרת והמסד (request_decide), ולכן גם מי
// שמתעסק עם הדפדפן לא יכול לכתוב שום דבר אחר.

export type RequestItem = {
  finding_id: number
  title: string | null
  message_text: string | null
  price_original: number | null
  price_aftermarket: number | null
  warranty_original: string | null
  warranty_aftermarket: string | null
  labor_hours: number | null
  part_diff: string | null
  single_reason: string | null
  safety: boolean
  eta: string | null
  photos: string[]
  discount_pct: number | null
  list_price_original: number | null
  list_price_aftermarket: number | null
}

type Pick = "original" | "aftermarket" | "declined"

const money = (n: number | null) => (n === null ? "—" : `${Number(n).toLocaleString("he-IL")} ש"ח`)

export function RequestForm({
  token,
  items,
  agreed = [],
}: {
  token: string
  items: RequestItem[]
  /** מה שכבר אושר בקבלה ובהודעות קודמות: כותרת וסכום (029). */
  agreed?: { title: string; price: number | null }[]
}) {
  const router = useRouter()
  const [picks, setPicks] = useState<Record<number, Pick>>({})
  // הבחירות נשמרות בדפדפן עד השליחה (ביקורת UX חוזרת, 8.10, ממצא 7): רענון או חזרה לדף לא מאפסים
  // שלושה ממצאים שכבר הוחלטו. רק טיוטה: ההחלטה נרשמת במסד רק בשליחה, ונמחקת מכאן אחריה.
  const draftKey = `approve-draft:${token}`
  useEffect(() => {
    // אחרי ההידרציה, לא בזמן הרינדור: השרת לא מכיר את הטיוטה שבדפדפן
    let raw: string | null = null
    try {
      raw = sessionStorage.getItem(draftKey)
    } catch {}
    if (!raw) return
    const saved = JSON.parse(raw) as Record<number, Pick>
    const id = setTimeout(() => setPicks(saved), 0)
    return () => clearTimeout(id)
  }, [draftKey])
  const choose = (id: number, p: Pick) =>
    setPicks((prev) => {
      const next = { ...prev, [id]: p }
      try {
        sessionStorage.setItem(draftKey, JSON.stringify(next))
      } catch {}
      return next
    })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const done = items.every((i) => picks[i.finding_id])
  const picked = items.filter((i) => picks[i.finding_id]).length
  const nextOpen = items.find((i) => !picks[i.finding_id])
  const total = items.reduce((sum, i) => {
    const p = picks[i.finding_id]
    if (p === "original") return sum + Number(i.price_original ?? 0)
    if (p === "aftermarket") return sum + Number(i.price_aftermarket ?? 0)
    return sum
  }, 0)

  const agreedSum = agreed.reduce((sum, l) => sum + Number(l.price ?? 0), 0)

  async function submit() {
    setBusy(true)
    setError("")
    const res = await decideRequest(
      token,
      items.map((i) => {
        const p = picks[i.finding_id]
        return { finding_id: i.finding_id, decision: p === "declined" ? "declined" : "approved", part_choice: p === "declined" ? null : p }
      }),
    )
    setBusy(false)
    if (!res.ok) {
      setError("לא הצלחנו לשמור את התשובה. אפשר להתקשר אלינו: 055-3048489")
      return
    }
    try {
      sessionStorage.removeItem(draftKey)
    } catch {}
    router.refresh()
  }

  return (
    <div className="req">
      <ol className="req-items">
        {items.map((i, n) => {
          const both = i.price_aftermarket !== null
          const opts: { key: Pick; label: string; price: number | null; warranty: string | null }[] = both
            ? [
                { key: "original", label: "חלק מקורי", price: i.price_original, warranty: i.warranty_original },
                { key: "aftermarket", label: "חלק חלופי", price: i.price_aftermarket, warranty: i.warranty_aftermarket },
              ]
            : [{ key: "original", label: "לאשר", price: i.price_original, warranty: i.warranty_original }]
          const pick = picks[i.finding_id]
          return (
            <li key={i.finding_id} id={`req-item-${i.finding_id}`} className={`req-item ${pick ? `picked-${pick}` : ""}`}>
              <h2 className="approve-title">
                <span className="req-n">{n + 1}</span> {i.title}
              </h2>
              {i.safety && <p className="approve-safety">ליקוי בטיחותי. אם לא מתקנים, אנחנו מחויבים לדווח עליו לרשות הרישוי.</p>}

              {i.photos.length > 0 && (
                <div className="approve-photos">
                  {i.photos.map((src, k) => (
                    <a key={src} href={src} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`מה שהמכונאי צילם, תמונה ${k + 1}`} loading="lazy" />
                    </a>
                  ))}
                </div>
              )}

              {i.message_text && <p className="approve-message">{i.message_text}</p>}

              <p className="staff-meta">
                {i.labor_hours !== null ? `שעות עבודה צפויות: ${Number(i.labor_hours).toLocaleString("he-IL")}` : ""}
                {i.eta ? ` · אם מאשרים, מוכן ${i.eta}` : ""}
              </p>
              {i.part_diff && <p className="approve-diff">ההבדל בין מקורי לחלופי: {i.part_diff}</p>}
              {i.single_reason && <p className="approve-diff">{i.single_reason}</p>}
              {Number(i.discount_pct) > 0 && i.list_price_original !== null && (
                <p className="approve-discount">
                  כולל <b>הנחה של {Number(i.discount_pct).toLocaleString("he-IL")}%</b>. במחירון:{" "}
                  <s className="num">{money(i.list_price_original)}</s>
                  {i.list_price_aftermarket !== null && (
                    <>
                      , חלופי <s className="num">{money(i.list_price_aftermarket)}</s>
                    </>
                  )}
                  .
                </p>
              )}

              <fieldset className="approve-choice req-choice">
                <legend>מה עושים?</legend>
                {opts.map((o) => (
                  <label key={o.key} className={pick === o.key ? "picked" : ""}>
                    <input type="radio" name={`p-${i.finding_id}`} checked={pick === o.key} onChange={() => choose(i.finding_id, o.key)} />
                    <span>
                      {o.label}
                      {o.warranty && <small>אחריות: {o.warranty}</small>}
                    </span>
                    <b className="num">{money(o.price)}</b>
                  </label>
                ))}
                <label className={pick === "declined" ? "picked declined" : ""}>
                  <input type="radio" name={`p-${i.finding_id}`} checked={pick === "declined"} onChange={() => choose(i.finding_id, "declined")} />
                  <span>לא עכשיו, לא לתקן</span>
                </label>
              </fieldset>
            </li>
          )
        })}
      </ol>

      {agreed.length > 0 && (
        <div className="req-agreed">
          <p className="req-agreed-title">כבר אושר קודם:</p>
          <ul>
            {agreed.map((l, i) => (
              <li key={i}>
                {l.title} · <span className="num">{money(l.price)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="req-foot">
        <p>
          {done ? (
            <>
              סה"כ למה שאישרת עכשיו: <b className="num">{money(total)}</b> (כולל חלקים, עבודה ומע"מ)
              {agreed.length > 0 && (
                <>
                  <br />
                  סה"כ לתשלום אחרי האישור הזה: <b className="num">{money(agreedSum + total)}</b>
                </>
              )}
            </>
          ) : (
            // ביקורת UX חיצונית, 8.10, ממצא 11: ההתקדמות והסכום כל הזמן, ודרך להגיע לפריט שנשכח
            <>
              נבחרו <b className="num">{picked}</b> מתוך <b className="num">{items.length}</b>
              {total > 0 && (
                <>
                  {" "}
                  · עד עכשיו <b className="num">{money(total)}</b>
                </>
              )}
              {nextOpen && (
                <>
                  <br />
                  <button
                    className="link-btn"
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(`req-item-${nextOpen.finding_id}`)
                      el?.scrollIntoView({ behavior: "smooth", block: "center" })
                      el?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true })
                    }}
                  >
                    לפריט שעוד לא בחרת ({items.indexOf(nextOpen) + 1})
                  </button>
                </>
              )}
            </>
          )}
        </p>
        {error && <p className="staff-error" role="alert">{error}</p>}
        <button className="btn big" type="button" disabled={!done || busy} onClick={submit}>
          {busy ? "רגע..." : "לשלוח את התשובה"}
        </button>
      </div>
    </div>
  )
}
