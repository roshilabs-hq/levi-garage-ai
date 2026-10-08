import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStaff } from "@/lib/staff/session"
import { staffUploadAllowed } from "@/lib/staff/ai-quota"
import { sniffPhoto } from "@/lib/staff/sniff"

// דניאל מוסיף תמונה לממצא שכבר קיים. המסלול החלופי לכלל "אדום או בטיחות — עם תמונה":
// המכונאי דיווח מהליפט בלי לצלם, והתור מסמן "חסרה תמונה". דניאל ניגש לרכב עם
// הנייד, מצלם, והתמונה נקשרת לממצא הזה בלבד — היא זו שתגיע ללקוח עם ההצעה.

const MAX_PHOTO = 12 * 1024 * 1024
const ALLOWED_PHOTO = ["image/jpeg", "image/png", "image/webp"]

export async function POST(req: Request) {
  const staff = await getStaff()
  // גם המכונאי: באבחון הוא צילם ודיבר, ואחר כך רוצה להוסיף עוד תמונה לאותו פריט
  // (רועי, 29.9). רק לממצא שעוד לא נשלח (למטה), כמו אצל דניאל.
  if (!staff || staff.role === "display") {
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
  // הסוג לפי התוכן, לא לפי מה שהדפדפן הצהיר (ביקורת אבטחה חיצונית, 7.10, ממצא 8)
  const type = sniffPhoto(bytes)
  if (!type) return NextResponse.json({ error: "photo" }, { status: 400 })
  // מכסת העלאות לפני השמירה (ביקורת חוזרת, 8.10, ממצא 3)
  if (!(await staffUploadAllowed(staff.id))) return NextResponse.json({ error: "upload-limit" }, { status: 429 })
  const path = `job-${finding.job_card_id}/add-${finding.id}-${Date.now()}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`
  const up = await supabase.storage.from("job-media").upload(path, bytes, { contentType: type, upsert: false })
  if (up.error) return NextResponse.json({ error: "upload" }, { status: 502 })

  const { error } = await supabase.from("media").insert({
    job_card_id: finding.job_card_id,
    finding_id: finding.id,
    kind: "photo",
    storage_path: path,
    mime: type,
    bytes: bytes.length,
    created_by: staff.id,
  })
  if (error) return NextResponse.json({ error: "save" }, { status: 502 })

  return NextResponse.json({ ok: true })
}
