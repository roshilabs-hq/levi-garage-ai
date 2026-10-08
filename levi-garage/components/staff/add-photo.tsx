"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { shrink } from "./capture-button"

// דניאל משלים תמונה לממצא שהגיע בלי תמונה. מהנייד שלו, ליד הרכב.
export function AddPhoto({ findingId, missing }: { findingId: number; missing: boolean }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement | null>(null)
  const [state, setState] = useState<"idle" | "sending" | "error" | "limit">("idle")

  async function onPick(list: FileList | null) {
    const file = list?.[0]
    if (input.current) input.current.value = ""
    if (!file) return
    setState("sending")
    const form = new FormData()
    form.append("finding_id", String(findingId))
    form.append("photo", await shrink(file), "photo.jpg")
    const res = await fetch("/api/staff/finding-photo", { method: "POST", body: form }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok || !json.ok) return setState(json?.error === "upload-limit" ? "limit" : "error")
    setState("idle")
    router.refresh()
  }

  return (
    <div className="add-photo">
      {missing && <span className="missing-photo">חסרה תמונה</span>}
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPick(e.target.files)} />
      <button type="button" className="btn quiet" onClick={() => input.current?.click()} disabled={state === "sending"}>
        {state === "sending" ? "מעלה..." : missing ? "לצלם ולצרף" : "להוסיף תמונה"}
      </button>
      {state === "error" && <span className="staff-meta" role="status">התמונה לא נשמרה. לנסות שוב.</span>}
      {state === "limit" && <span className="staff-meta" role="status">התמונה לא נשמרה: הרבה העלאות בשעה האחרונה. לנסות שוב בעוד כמה דקות.</span>}
    </div>
  )
}
