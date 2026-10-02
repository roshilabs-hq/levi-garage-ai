"use client"

import { useState } from "react"

import { receiveCar } from "@/app/(he)/staff/actions"

// קבלת רכב בדלפק. מה שהחוק דורש לפני הצעת מחיר (ס' 131–132) מופיע כאן מול
// דניאל, כדי שיגיד אותו ללקוח בקול: סוגי חלקים, ההבדל, האחריות והשעות.
//
// 30.9: כמה עבודות בקבלה אחת ("הכנה לטסט וגם טיפול"), והצעה אחת שמאשרים בדלפק.
// ועותק מודפס ללקוח שעומד מול הדלפק, גם כשההצעה יוצאת במייל.

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

type Line = { id: number; choice: "original" | "aftermarket" }

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
  const first = items.find((i) => i.code === defaultCode)?.id ?? items[0]?.id
  const [lines, setLines] = useState<Line[]>(() => (first ? [{ id: first, choice: "original" }] : []))
  const [busy, setBusy] = useState(false)
  const byId = (id: number) => items.find((i) => i.id === id)

  const picked = lines.map((l) => ({ ...l, item: byId(l.id)! })).filter((l) => l.item)
  const anyTwo = picked.some((l) => l.item.price_aftermarket !== null)
  const total = picked.reduce(
    (sum, l) => sum + Number(l.choice === "aftermarket" && l.item.price_aftermarket !== null ? l.item.price_aftermarket : l.item.price_original),
    0,
  )
  const hoursTotal = picked.reduce((sum, l) => sum + Number(l.item.labor_hours), 0)

  const setLine = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const unused = items.filter((it) => !lines.some((l) => l.id === it.id))

  return (
    <form action={receiveCar} className="arrive-form" onSubmit={() => setBusy(true)}>
      <input type="hidden" name="booking_id" value={bookingId} />
      {picked.map((l) => (
        <input key={l.id} type="hidden" name="line" value={`${l.id}:${l.choice}`} />
      ))}

      <p className="arrive-label">מה עושים ברכב</p>
      <ol className="arrive-lines">
        {picked.map((l, i) => {
          const it = l.item
          const both = it.price_aftermarket !== null
          return (
            <li key={`${l.id}-${i}`} className="arrive-line">
              <div className="arrive-line-head">
                <select
                  aria-label={`עבודה ${i + 1}`}
                  value={l.id}
                  onChange={(e) => setLine(i, { id: Number(e.target.value), choice: "original" })}
                >
                  {items
                    .filter((x) => x.id === l.id || !lines.some((y) => y.id === x.id))
                    .map((x) => (
                      <option key={x.id} value={x.id}>{x.title}</option>
                    ))}
                </select>
                {lines.length > 1 && (
                  <button type="button" className="link-btn" onClick={() => setLines((prev) => prev.filter((_, k) => k !== i))}>
                    להסיר
                  </button>
                )}
              </div>
              <div className="arrive-offer">
                {both ? (
                  <fieldset>
                    <legend>איזה חלק הלקוח בוחר</legend>
                    {(["original", "aftermarket"] as const).map((k) => (
                      <label key={k} className={l.choice === k ? "picked" : ""}>
                        <input type="radio" name={`part-${i}`} checked={l.choice === k} onChange={() => setLine(i, { choice: k })} />
                        <span>{k === "original" ? "חלק מקורי" : "חלק חלופי"}</span>
                        <b className="num">{money(k === "original" ? it.price_original : it.price_aftermarket)}</b>
                        <small>אחריות: {k === "original" ? it.warranty_original : it.warranty_aftermarket}</small>
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <p className="arrive-single">
                    <b className="num">{money(it.price_original)}</b> · אחריות: {it.warranty_original}
                  </p>
                )}
                <p className="arrive-diff">להגיד ללקוח: {both ? it.part_diff : it.single_reason}</p>
                <p className="staff-meta">שעות עבודה צפויות: {Number(it.labor_hours).toLocaleString("he-IL")}</p>
              </div>
            </li>
          )
        })}
      </ol>

      {unused.length > 0 && (
        <button type="button" className="btn quiet arrive-add" onClick={() => setLines((prev) => [...prev, { id: unused[0].id, choice: "original" }])}>
          + עוד עבודה
        </button>
      )}

      {picked.length > 1 && (
        <p className="arrive-total">
          סה"כ בהצעה: <b className="num">{money(total)}</b> · {hoursTotal.toLocaleString("he-IL")} שעות עבודה · כולל מע"מ
        </p>
      )}

      <label htmlFor="odometer">קילומטראז' בקבלה</label>
      <input id="odometer" name="odometer" inputMode="numeric" dir="ltr" placeholder="למשל 128400" />

      <label htmlFor="email">מייל להצעת המחיר</label>
      <input id="email" name="email" type="email" dir="ltr" defaultValue={email ?? ""} placeholder="לקוח בלי מייל? משאירים ריק, וההצעה מודפסת" />

      <label className="arrive-check">
        <input type="checkbox" name="print_copy" />
        <span>להדפיס גם עותק ללקוח שעומד מול הדלפק</span>
      </label>

      <label className="arrive-check">
        <input type="checkbox" name="consent" defaultChecked={consent} />
        <span>הלקוח מסכים לקבל עדכונים להצעה בוואטסאפ ובמייל (אם יימצא משהו נוסף ברכב)</span>
      </label>

      <label className="arrive-check">
        <input type="checkbox" name="explained" required />
        <span>{anyTwo ? "הסברתי ללקוח את ההבדל בין חלק מקורי לחלופי, את האחריות ואת שעות העבודה" : "הסברתי ללקוח את המחיר, את האחריות ואת שעות העבודה"}</span>
      </label>

      <label className="arrive-check">
        <input type="checkbox" name="on_paper" />
        <span>ללקוח אין סמארטפון: הוא יחתום על עותק מודפס של ההצעה, במקום לאשר בקישור</span>
      </label>

      <p className="arrive-approval">
        <b>הלקוח מאשר את ההצעה בעצמו{picked.length > 1 ? ", על כל העבודות שבה," : ""} כולל האבחון.</b> אחרי הלחיצה יוצא אליו קישור לאישור,
        בוואטסאפ ובמייל, והוא יכול לאשר מהטלפון כבר כאן מול הדלפק. עד שהוא מאשר, הרכב מחכה בחניה ולא עולה לליפט.
      </p>

      <button className="btn" type="submit" disabled={busy || picked.length === 0}>
        {busy ? "פותחים כרטיס..." : "קבלת רכב ושליחת ההצעה לאישור"}
      </button>
      <p className="staff-meta">
        מותר לבצע רק את מה שבהצעה הזו, ורק אחרי שהלקוח אישר. כל דבר נוסף שיימצא נשלח אליו בנפרד, ולא נוגעים בו עד
        שהוא מאשר. לקוח שחתם על עותק מודפס: לסמן &quot;חתם&quot; בלוח היום, ואז הרכב נכנס לתור.
      </p>
    </form>
  )
}
