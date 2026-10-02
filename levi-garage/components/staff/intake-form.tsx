"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { decideIntake } from "@/app/(he)/approve/actions"

// הלקוח מאשר את ההצעה של הקבלה, כולה (036). שני כפתורים, בלי בחירות: על סוג החלק
// ועל העבודות כבר דיברו מול דניאל בדלפק, וכאן רק "כן, תתחילו" או "לא, תתקשרו".
// ההכרעה נשמרת דרך השרת והמסד (intake_decide), ולכן אי אפשר לכתוב שום דבר אחר.

export function IntakeForm({ token }: { token: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<"approved" | "declined" | null>(null)
  const [sure, setSure] = useState(false)
  const [error, setError] = useState("")

  const decide = async (decision: "approved" | "declined") => {
    setBusy(decision)
    setError("")
    const r = await decideIntake(token, decision)
    if (!r.ok) {
      setError("לא הצלחנו לשמור. אולי הקישור כבר לא בתוקף. אפשר להתקשר אלינו: 055-3048489.")
      setBusy(null)
      return
    }
    router.refresh()
  }

  return (
    <div className="intake-actions">
      <button className="btn big" type="button" disabled={busy !== null} onClick={() => decide("approved")}>
        {busy === "approved" ? "שומרים…" : "מאשר את ההצעה, אפשר להתחיל"}
      </button>
      {!sure ? (
        <button className="btn quiet" type="button" disabled={busy !== null} onClick={() => setSure(true)}>
          לא מאשר
        </button>
      ) : (
        <div className="intake-sure" role="group" aria-label="לא מאשר">
          <p>בלי אישור לא נוגעים ברכב, ודניאל יתקשר אליך לדבר על זה. לשלוח?</p>
          <button className="btn quiet" type="button" disabled={busy !== null} onClick={() => decide("declined")}>
            {busy === "declined" ? "שומרים…" : "כן, לא מאשר"}
          </button>
          <button className="btn quiet" type="button" disabled={busy !== null} onClick={() => setSure(false)}>
            חזרה
          </button>
        </div>
      )}
      {error && (
        <p className="staff-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
