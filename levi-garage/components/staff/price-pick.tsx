"use client"

import { useActionState } from "react"

import { addFromPriceList, type PickResult } from "@/app/(he)/staff/actions"

// ממצא מהמחירון, מהעמדה (רועי, 28.9). הדוגמה שלו: הכנה לטסט, ונמצא פנס שרוף.
// לא צריך צילום ולא הקלטה: נוגעים בכפתור, והממצא נכנס לדניאל כבר עם המחיר מהמחירון.
//
// מ-30.9 שום דבר לא יוצא ללקוח מהעמדה (רועי: "ממש לא. הודעה אחת מרוכזת, על ידי
// דניאל"). הכפתורים הגדולים הם העבודות הנפוצות במחיר קבוע; כל השאר ברשימה.
//
// 4.10 (רועי: "לדעתי חשוב"): אותו רכיב גם בכרטיס העבודה, לדניאל ולאבי. הלקוח
// נזכר בדלפק ("תבדקו גם את המזגן"), או שמכונאי אמר בעל פה. ה-RPC כבר מרשה
// להם (add_price_list_finding); חסר היה רק הכפתור. שם הנוסח פונה אליהם.

export type PickItem = { id: number; title: string; price_original: number; fixed_price: boolean }

// "זה כבר נרשם" נשאר גם אצל דניאל; "דניאל שולח ללקוח" לא מתאים כשדניאל עצמו הוסיף.
const PICK_EXISTS = "זה כבר נרשם ברכב הזה."

const money = (n: number) => `${Number(n).toLocaleString("he-IL")} ש"ח`

const TEXT = {
  station: {
    summary: "נמצא משהו מהמחירון",
    meta: "בלי צילום ובלי מחיר: נוגעים, וזה עובר לדניאל עם המחיר מהמחירון. הוא שולח ללקוח הודעה אחת עם כל מה שנמצא.",
    add: "לדניאל",
    done: "עבר לדניאל.",
  },
  office: {
    summary: "+ ממצא: עבודה מהמחירון",
    meta: "הלקוח ביקש עוד משהו, או שמכונאי אמר לך בעל פה? בוחרים עבודה, והיא נכנסת ל\"לשלוח ללקוח\" עם המחיר מהמחירון. שם אפשר לערוך את הנוסח, את המחיר ואת ההנחה, ולצרף תמונה, ושולחים יחד עם השאר.",
    add: "להוסיף",
    done: "נוסף ל\"לשלוח ללקוח\".",
  },
}

export function PricePick({ jobId, items, who = "station" }: { jobId: number; items: PickItem[]; who?: "station" | "office" }) {
  const t = TEXT[who]
  const [result, action, pending] = useActionState<PickResult, FormData>(addFromPriceList, null)
  const quick = items.filter((i) => i.fixed_price && i.price_original <= 500)
  const rest = items.filter((i) => !(i.fixed_price && i.price_original <= 500))

  return (
    <details className="pick">
      <summary>{t.summary}</summary>
      <p className="staff-meta">{t.meta}</p>

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
          <option value="" disabled>עבודה אחרת מהמחירון</option>
          {rest.map((i) => (
            <option key={i.id} value={i.id}>{i.title}</option>
          ))}
        </select>
        <button className="btn quiet" type="submit" disabled={pending}>{t.add}</button>
      </form>

      {pending && <p className="staff-meta" role="status">רושמים...</p>}
      {!pending && result && (
        <p className={`pick-msg ${result.ok ? (result.sent ? "sent" : "draft") : "error"}`} role="status">
          {!result.ok ? result.error : who === "office" && result.why !== PICK_EXISTS ? t.done : result.why ?? t.done}
        </p>
      )}
    </details>
  )
}
