"use client"

import { useMemo, useState } from "react"

import { receiveCar } from "@/app/(he)/staff/actions"

// קבלת רכב בדלפק. מה שהחוק דורש לפני הצעת מחיר (ס' 131–132) מופיע כאן מול
// דניאל, כדי שיגיד אותו ללקוח בקול: שני סוגי חלקים, ההבדל, האחריות והשעות.

export type PriceItem = {
  id: number
  code: string
  title: string
  category: string
  labor_hours: number
  price_original: number
  price_aftermarket: number | null
  warranty_original: string
  warranty_aftermarket: string | null
  part_diff: string | null
  single_reason: string | null
}

const money = (n: number | null) => (n === null ? "—" : `${Number(n).toLocaleString("he-IL")} ש"ח`)

export function ArriveForm({
  bookingId,
  items,
  defaultCode,
  email,
  consent,
}: {
  bookingId: number
  items: PriceItem[]
  defaultCode: string
  email: string | null
  consent: boolean
}) {
  const [id, setId] = useState(() => items.find((i) => i.code === defaultCode)?.id ?? items[0]?.id)
  const item = useMemo(() => items.find((i) => i.id === id), [items, id])
  const [choice, setChoice] = useState<"original" | "aftermarket">("original")
  const [busy, setBusy] = useState(false)
  const both = item?.price_aftermarket !== null && item?.price_aftermarket !== undefined

  return (
    <form action={receiveCar} className="arrive-form" onSubmit={() => setBusy(true)}>
      <input type="hidden" name="booking_id" value={bookingId} />

      <label htmlFor="price_list_id">מה עושים ברכב</label>
      <select id="price_list_id" name="price_list_id" value={id} onChange={(e) => { setId(Number(e.target.value)); setChoice("original") }}>
        {items.map((i) => (
          <option key={i.id} value={i.id}>{i.title}</option>
        ))}
      </select>

      {item && (
        <div className="arrive-offer">
          {both ? (
            <fieldset>
              <legend>איזה חלק הלקוח בוחר</legend>
              {(["original", "aftermarket"] as const).map((k) => (
                <label key={k} className={choice === k ? "picked" : ""}>
                  <input type="radio" name="part_choice" value={k} checked={choice === k} onChange={() => setChoice(k)} />
                  <span>{k === "original" ? "חלק מקורי" : "חלק חלופי"}</span>
                  <b className="num">{money(k === "original" ? item.price_original : item.price_aftermarket)}</b>
                  <small>אחריות: {k === "original" ? item.warranty_original : item.warranty_aftermarket}</small>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="arrive-single">
              <b className="num">{money(item.price_original)}</b> · אחריות: {item.warranty_original}
              <input type="hidden" name="part_choice" value="original" />
            </p>
          )}
          <p className="arrive-diff">
            {both ? <>להגיד ללקוח: {item.part_diff}</> : <>אין חלופה: {item.single_reason}</>}
          </p>
          <p className="staff-meta">
            שעות עבודה צפויות: {Number(item.labor_hours).toLocaleString("he-IL")} · {both ? "המחיר כולל חלקים, עבודה ומע\"מ" : "המחיר כולל מע\"מ"}
          </p>
        </div>
      )}

      <label htmlFor="odometer">קילומטראז' בקבלה</label>
      <input id="odometer" name="odometer" inputMode="numeric" dir="ltr" placeholder="למשל 128400" />

      <label htmlFor="email">מייל להצעת המחיר</label>
      <input id="email" name="email" type="email" dir="ltr" defaultValue={email ?? ""} placeholder="לקוח בלי מייל? משאירים ריק, וההצעה מודפסת" />

      <label className="arrive-check">
        <input type="checkbox" name="consent" defaultChecked={consent} />
        <span>הלקוח מסכים לקבל עדכונים להצעה בוואטסאפ ובמייל (אם יימצא משהו נוסף ברכב)</span>
      </label>

      <label className="arrive-check">
        <input type="checkbox" name="explained" required />
        <span>{both ? "הסברתי ללקוח את ההבדל בין חלק מקורי לחלופי, את האחריות ואת שעות העבודה" : "הסברתי ללקוח את המחיר, את האחריות ואת שעות העבודה"}</span>
      </label>

      <label className="arrive-check">
        <input type="checkbox" name="approved" required />
        <span>
          <b>הלקוח אישר את ההצעה לטיפול הזה, כולל האבחון.</b> כל דבר נוסף שיימצא ברכב יישלח אליו לאישור בנפרד.
        </span>
      </label>

      <button className="btn" type="submit" disabled={busy || !item}>
        {busy ? "פותחים כרטיס..." : "קבלת רכב ושליחת הצעת מחיר"}
      </button>
      <p className="staff-meta">
        בלי אישור הלקוח לא מבצעים שום עבודה שלא בהצעה. הרכב עובר לחניה ומחכה לליפט פנוי, והאבחון נעשה על הליפט.
      </p>
    </form>
  )
}
