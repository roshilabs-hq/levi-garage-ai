"use client"

import { useActionState } from "react"

import { addFromPriceList, type PickResult } from "@/app/(he)/staff/actions"

// ממצא מהמחירון, מהעמדה (רועי, 28.9). הדוגמה שלו: הכנה לטסט, ונמצא פנס שרוף.
// לא צריך צילום ולא הקלטה: נוגעים בכפתור, והלקוח מקבל קישור עם המחיר מהמחירון.
//
// הכפתורים הגדולים הם העבודות במחיר קבוע (אותו מחיר לכל רכב) ועד 500 ש"ח —
// אלה יוצאות ללקוח מיד. כל השאר ברשימה, ועוברות לדניאל: חלק שמחירו תלוי בדגם
// הוא בדיוק המקום שבו צריך בן אדם שבודק מול הספק.

export type PickItem = { id: number; title: string; price_original: number; fixed_price: boolean }

const money = (n: number) => `${Number(n).toLocaleString("he-IL")} ש"ח`

export function PricePick({ jobId, items }: { jobId: number; items: PickItem[] }) {
  const [result, action, pending] = useActionState<PickResult, FormData>(addFromPriceList, null)
  const quick = items.filter((i) => i.fixed_price && i.price_original <= 500)
  const rest = items.filter((i) => !(i.fixed_price && i.price_original <= 500))

  return (
    <details className="pick">
      <summary>נמצא משהו מהמחירון</summary>
      <p className="staff-meta">בלי צילום ובלי מחיר: נוגעים, והלקוח מקבל קישור לאישור.</p>

      <div className="pick-quick">
        {quick.map((i) => (
          <form key={i.id} action={action}>
            <input type="hidden" name="job_id" value={jobId} />
            <input type="hidden" name="price_list_id" value={i.id} />
            <button className="pick-btn" type="submit" disabled={pending}>
              <span>{i.title}</span>
              <small className="num">{money(i.price_original)}</small>
            </button>
          </form>
        ))}
      </div>

      <form action={action} className="pick-more">
        <input type="hidden" name="job_id" value={jobId} />
        <select name="price_list_id" defaultValue="" required aria-label="עבודה אחרת מהמחירון">
          <option value="" disabled>עבודה אחרת (עוברת לדניאל)</option>
          {rest.map((i) => (
            <option key={i.id} value={i.id}>{i.title}</option>
          ))}
        </select>
        <button className="btn quiet" type="submit" disabled={pending}>לדניאל</button>
      </form>

      {pending && <p className="staff-meta" role="status">רושמים...</p>}
      {!pending && result && (
        <p className={`pick-msg ${result.ok ? (result.sent ? "sent" : "draft") : "error"}`} role="status">
          {!result.ok ? result.error : result.sent ? "נשלח ללקוח. הוא יאשר בקישור, ותראו את זה כאן." : result.why ?? "עבר לדניאל."}
        </p>
      )}
    </details>
  )
}
