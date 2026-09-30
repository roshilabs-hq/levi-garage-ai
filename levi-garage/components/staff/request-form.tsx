"use client"

import { useState } from "react"
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

export function RequestForm({ token, items }: { token: string; items: RequestItem[] }) {
  const router = useRouter()
  const [picks, setPicks] = useState<Record<number, Pick>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const done = items.every((i) => picks[i.finding_id])
  const total = items.reduce((sum, i) => {
    const p = picks[i.finding_id]
    if (p === "original") return sum + Number(i.price_original ?? 0)
    if (p === "aftermarket") return sum + Number(i.price_aftermarket ?? 0)
    return sum
  }, 0)

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
            <li key={i.finding_id} className={`req-item ${pick ? `picked-${pick}` : ""}`}>
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
                    <input type="radio" name={`p-${i.finding_id}`} checked={pick === o.key} onChange={() => setPicks((p) => ({ ...p, [i.finding_id]: o.key }))} />
                    <span>
                      {o.label}
                      {o.warranty && <small>אחריות: {o.warranty}</small>}
                    </span>
                    <b className="num">{money(o.price)}</b>
                  </label>
                ))}
                <label className={pick === "declined" ? "picked declined" : ""}>
                  <input type="radio" name={`p-${i.finding_id}`} checked={pick === "declined"} onChange={() => setPicks((p) => ({ ...p, [i.finding_id]: "declined" }))} />
                  <span>לא עכשיו, לא לתקן</span>
                </label>
              </fieldset>
            </li>
          )
        })}
      </ol>

      <div className="req-foot">
        <p>
          {done ? (
            <>
              סה"כ למה שאישרת: <b className="num">{money(total)}</b> (כולל חלקים, עבודה ומע"מ)
            </>
          ) : (
            `לבחור לכל פריט: לאשר או לא. ${items.length - Object.keys(picks).length} עוד לא נבחרו.`
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
