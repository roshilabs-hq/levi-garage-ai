"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { decideApproval } from "@/app/(he)/approve/actions"

// הבחירה של הלקוח: איזה חלק, ואישור או דחייה. ההכרעה נשמרת דרך השרת והמסד
// (approval_decide), ולכן גם מי שמתעסק עם הדפדפן לא יכול לכתוב שום דבר אחר.

type Option = { key: "original" | "aftermarket"; label: string; price: number; warranty: string | null }

export function ApproveForm({
  token,
  priceOriginal,
  priceAftermarket,
  warrantyOriginal,
  warrantyAftermarket,
}: {
  token: string
  priceOriginal: number | null
  priceAftermarket: number | null
  warrantyOriginal: string | null
  warrantyAftermarket: string | null
}) {
  const router = useRouter()
  const both = priceOriginal !== null && priceAftermarket !== null
  const [choice, setChoice] = useState<"original" | "aftermarket">(priceAftermarket !== null ? "aftermarket" : "original")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const money = (n: number) => `${Number(n).toLocaleString("he-IL")} ש"ח`

  const options: Option[] = [
    ...(priceOriginal !== null ? [{ key: "original" as const, label: both ? "חלק מקורי" : "מחיר", price: priceOriginal, warranty: warrantyOriginal }] : []),
    ...(priceAftermarket !== null ? [{ key: "aftermarket" as const, label: "חלק חלופי", price: priceAftermarket, warranty: warrantyAftermarket }] : []),
  ]

  async function decide(decision: "approved" | "declined") {
    setBusy(true)
    setError("")
    const res = await decideApproval(token, decision, decision === "approved" ? choice : null)
    setBusy(false)
    if (!res.ok) {
      setError("לא הצלחנו לשמור את התשובה. אפשר להתקשר אלינו: 04-0000000")
      return
    }
    router.refresh()
  }

  return (
    <div className="approve-choice">
      {options.length > 1 && (
        <fieldset>
          <legend>איזה חלק להזמין?</legend>
          {options.map((o) => (
            <label key={o.key} className={choice === o.key ? "picked" : ""}>
              <input type="radio" name="part" value={o.key} checked={choice === o.key} onChange={() => setChoice(o.key)} />
              <span>
                {o.label}
                {o.warranty && <small>אחריות: {o.warranty}</small>}
              </span>
              <b className="num">{money(o.price)}</b>
            </label>
          ))}
        </fieldset>
      )}

      {options.length === 1 && (
        <p className="approve-single">
          {options[0].label}: <b className="num">{money(options[0].price)}</b>
          {options[0].warranty && <small> · אחריות: {options[0].warranty}</small>}
        </p>
      )}

      {error && <p className="staff-error" role="alert">{error}</p>}

      <div className="approve-buttons">
        <button className="btn" type="button" disabled={busy} onClick={() => decide("approved")}>
          {busy ? "רגע..." : "מאשר/ת, תתקנו"}
        </button>
        <button className="btn quiet" type="button" disabled={busy} onClick={() => decide("declined")}>
          לא מאשר/ת
        </button>
      </div>
    </div>
  )
}
