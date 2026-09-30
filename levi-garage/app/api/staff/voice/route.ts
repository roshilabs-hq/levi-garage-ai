import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStaff } from "@/lib/staff/session"
import { createFindingFromAudio } from "@/lib/staff/make-finding"
import { itemByKey } from "@/lib/staff/inspection"

// לכידה אחת של מכונאי: תמונה והקלטה, או רק אחת מהן. מהכפתור הגדול בדף הליפט
// ומבדיקת הכניסה, ועד טיוטת ממצא בכרטיס.
//
// הרכב לא נלקח מההקלטה אלא מהכרטיס (ממצא 2 ב-POC), ולכן מהדפדפן מגיעים רק
// מזהה הכרטיס, הקבצים, ובבדיקת כניסה — איזה פריט ובאיזה צבע. כל השאר מהמסד.

export const maxDuration = 90

const MAX_AUDIO = 20 * 1024 * 1024
const MAX_PHOTO = 12 * 1024 * 1024

// הדלי משווה mime כמחרוזת מדויקת, והדפדפן שולח "audio/webm;codecs=opus".
// בלי הניקוי הזה ההעלאה נדחית, המכונאי רואה "לא הצלחנו לשמור", ומה שאמר
// באמת אובד — בדיוק המקרה שכל המסלול נבנה כדי למנוע.
const ALLOWED_AUDIO = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"]
const ALLOWED_PHOTO = ["image/jpeg", "image/png", "image/webp"]

function audioMime(raw: string) {
  const base = (raw || "").split(";")[0].trim().toLowerCase()
  if (ALLOWED_AUDIO.includes(base)) return base
  // כינויים שמכשירים שולחים לאותם פורמטים בדיוק.
  if (base === "audio/x-m4a" || base === "audio/aac" || base === "audio/m4a") return "audio/mp4"
  if (base === "audio/x-wav" || base === "audio/wave") return "audio/wav"
  if (base === "audio/mp3") return "audio/mpeg"
  return "audio/webm"
}

function photoMime(raw: string) {
  const base = (raw || "").split(";")[0].trim().toLowerCase()
  return base === "image/jpg" ? "image/jpeg" : base || "image/jpeg"
}

export async function POST(req: Request) {
  const staff = await getStaff()
  if (!staff || staff.role === "display") return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const jobId = Number(form?.get("job_id"))
  const audioFile = form?.get("audio")
  const photoFile = form?.get("photo")
  const itemKey = String(form?.get("item") ?? "")
  const light = String(form?.get("light") ?? "")

  const audio = audioFile instanceof Blob && audioFile.size > 0 ? audioFile : null
  const photo = photoFile instanceof Blob && photoFile.size > 0 ? photoFile : null

  if (!Number.isFinite(jobId) || (!audio && !photo)) return NextResponse.json({ error: "bad" }, { status: 400 })
  if (audio && audio.size > MAX_AUDIO) return NextResponse.json({ error: "size" }, { status: 400 })
  if (photo && (photo.size > MAX_PHOTO || !ALLOWED_PHOTO.includes(photoMime(photo.type)))) {
    return NextResponse.json({ error: "photo" }, { status: 400 })
  }

  const item = itemKey ? itemByKey(itemKey) : undefined
  if (itemKey && (!item || (light !== "yellow" && light !== "red"))) return NextResponse.json({ error: "item" }, { status: 400 })
  // אדום או בטיחות בבדיקת הכניסה: תמונה חובה. הלקוח מאשר תיקון לפי מה שהוא רואה,
  // ובלי תמונה דניאל צריך לרדת לרכב בעצמו. הכפתור כבר לא מציע "בלי תמונה", וזה הגיבוי.
  if (item && (light === "red" || item.safety) && !photo) return NextResponse.json({ error: "photo" }, { status: 400 })

  const supabase = await createClient()

  // RLS כבר חוסם כרטיס שלא שייך לצוות, אבל בלי הכרטיס אין הקשר לרכב.
  const { data: job } = await supabase
    .from("job_cards")
    .select("id, plate, vehicle_make, vehicle_model, vehicle_year, engine_code, status")
    .eq("id", jobId)
    .maybeSingle()
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 })

  // הקבצים נשמרים לפני הניתוח: גם אם המודל ייפול, מה שהמכונאי אמר וצילם לא אובד.
  // לתמונה ולהקלטה של אותה לכידה יש אותה תחילית, וכך הניסיון החוזר מוצא את שתיהן.
  const base = `job-${job.id}/cap-${Date.now()}`
  const saved: { path: string; kind: "audio" | "photo"; mime: string; bytes: Buffer }[] = []

  if (photo) {
    const mime = photoMime(photo.type)
    const bytes = Buffer.from(await photo.arrayBuffer())
    const path = `${base}-p0.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`
    const up = await supabase.storage.from("job-media").upload(path, bytes, { contentType: mime, upsert: false })
    if (up.error) console.error("capture photo upload failed:", up.error.message)
    else saved.push({ path, kind: "photo", mime, bytes })
  }
  if (audio) {
    const mime = audioMime(audio.type)
    const bytes = Buffer.from(await audio.arrayBuffer())
    const path = `${base}.${mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm"}`
    const up = await supabase.storage.from("job-media").upload(path, bytes, { contentType: mime, upsert: false })
    if (up.error) console.error("capture audio upload failed:", up.error.message)
    else saved.push({ path, kind: "audio", mime, bytes })
  }
  if (saved.length === 0) return NextResponse.json({ error: "upload" }, { status: 502 })

  await supabase.from("media").insert(
    saved.map((m) => ({
      job_card_id: job.id,
      kind: m.kind,
      storage_path: m.path,
      mime: m.mime,
      bytes: m.bytes.length,
      created_by: staff.id,
    })),
  )

  const a = saved.find((m) => m.kind === "audio")
  const p = saved.find((m) => m.kind === "photo")

  try {
    const { finding_id, report } = await createFindingFromAudio({
      supabase,
      job,
      audio: a ? { bytes: a.bytes, mime: a.mime } : null,
      photo: p ? { bytes: p.bytes, mime: p.mime } : null,
      staffId: staff.id,
      mediaPaths: saved.map((m) => m.path),
      item: item ? { label: item.label, light: light as "yellow" | "red", safety: item.safety } : null,
      source: item ? "intake" : "voice",
    })

    if (item) {
      // הפריט בבדיקת הכניסה זוכר איזה ממצא נפתח ממנו. בפקודה אחת (027): ההקלטה לוקחת
      // 20–30 שניות, ובינתיים המכונאי לוחץ על פריטים אחרים. קריאה ושמירה של כל הרשימה
      // כאן דרסה אותם, או שהם דרסו אותה (נוזלים, 30.9).
      await supabase.rpc("set_inspection_item", { p_job_id: job.id, p_key: item.key, p_light: light, p_finding_id: finding_id })
    }

    return NextResponse.json({ ok: true, finding_id, title: report.title, red_list: report.red_list, urgency: report.urgency })
  } catch (e) {
    console.error("capture report failed:", (e as Error).message)
    // הקבצים שמורים, ולכן אפשר לנסות שוב מהכרטיס בלי לבקש מהמכונאי לדבר שוב.
    return NextResponse.json({ error: "model", saved: true }, { status: 502 })
  }
}
