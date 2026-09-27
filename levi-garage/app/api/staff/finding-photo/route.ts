import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStaff } from "@/lib/staff/session"

// דניאל מוסיף תמונה לממצא שכבר קיים. המסלול החלופי לכלל "אדום או בטיחות — עם תמונה":
// המכונאי דיווח מהליפט בלי לצלם, והתור מסמן "חסרה תמונה". דניאל ניגש לרכב עם
// הנייד, מצלם, והתמונה נקשרת לממצא הזה בלבד — היא זו שתגיע ללקוח עם ההצעה.

const MAX_PHOTO = 12 * 1024 * 1024
const ALLOWED_PHOTO = ["image/jpeg", "image/png", "image/webp"]

export async function POST(req: Request) {
  const staff = await getStaff()
  if (!staff || staff.role === "display" || staff.role === "mechanic") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const form = await req.formData().catch(() => null)
  const findingId = Number(form?.get("finding_id"))
  const file = form?.get("photo")
  const photo = file instanceof Blob && file.size > 0 ? file : null
  const mime = (photo?.type || "").split(";")[0].trim().toLowerCase().replace("image/jpg", "image/jpeg")

  if (!Number.isFinite(findingId) || !photo) return NextResponse.json({ error: "bad" }, { status: 400 })
  if (photo.size > MAX_PHOTO || !ALLOWED_PHOTO.includes(mime)) return NextResponse.json({ error: "photo" }, { status: 400 })

  const supabase = await createClient()
  const { data: finding } = await supabase.from("findings").select("id, job_card_id, status").eq("id", findingId).maybeSingle()
  if (!finding) return NextResponse.json({ error: "not found" }, { status: 404 })
  // אחרי השליחה התמונות כבר הועתקו לדף של הלקוח. תמונה שנוספת אחר כך לא תגיע אליו,
  // ולכן לא מעמידים פנים שכן.
  if (finding.status !== "draft") return NextResponse.json({ error: "sent" }, { status: 409 })

  const bytes = Buffer.from(await photo.arrayBuffer())
  const path = `job-${finding.job_card_id}/add-${finding.id}-${Date.now()}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`
  const up = await supabase.storage.from("job-media").upload(path, bytes, { contentType: mime, upsert: false })
  if (up.error) return NextResponse.json({ error: "upload" }, { status: 502 })

  const { error } = await supabase.from("media").insert({
    job_card_id: finding.job_card_id,
    finding_id: finding.id,
    kind: "photo",
    storage_path: path,
    mime,
    bytes: bytes.length,
    created_by: staff.id,
  })
  if (error) return NextResponse.json({ error: "save" }, { status: 502 })

  return NextResponse.json({ ok: true })
}
