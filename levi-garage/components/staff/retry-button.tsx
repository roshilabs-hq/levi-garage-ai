"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

// "נסה שוב" על הקלטה ששמורה אבל לא תומללה.
//
// ההודעה שהמכונאי ראה כשהמודל נפל הבטיחה בדיוק את הכפתור הזה, והוא לא היה
// קיים. בלעדיו הפתרון היה לבקש ממנו לרדת מתחת לרכב ולומר שוב את מה שכבר אמר.

export function RetryButton({ mediaId }: { mediaId: number }) {
  const router = useRouter()
  const [state, setState] = useState<"idle" | "working" | "error">("idle")
  const [message, setMessage] = useState("")

  async function retry() {
    setState("working")
    setMessage("")
    try {
      const res = await fetch("/api/staff/voice/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media_id: mediaId }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setState("error")
        setMessage(
          json?.error === "already"
            ? "כבר נוצרה טיוטה מההקלטה הזאת."
            : json?.error === "limit"
              ? "הרבה ניסיונות בשעה האחרונה. לנסות שוב בעוד כמה דקות."
              : "התמלול נכשל שוב. ההקלטה עדיין שמורה, אפשר להאזין לה.",
        )
        return
      }
      router.refresh()
    } catch {
      setState("error")
      setMessage("אין חיבור כרגע.")
    }
  }

  return (
    <>
      <button className="btn" type="button" onClick={retry} disabled={state === "working"}>
        {state === "working" ? "מתמללים..." : "נסה לתמלל שוב"}
      </button>
      {message && (
        <p className="job-note" role="status">
          {message}
        </p>
      )}
    </>
  )
}
