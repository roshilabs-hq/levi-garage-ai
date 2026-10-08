import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStaff } from "@/lib/staff/session"
import { staffAiAllowed, staffUploadAllowed } from "@/lib/staff/ai-quota"
import { sniffAudio, sniffPhoto } from "@/lib/staff/sniff"
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

// הדלי משווה mime כמחרוזת מדויקת, והדפדפן שולח "audio/webm;codecs=opus". לכן הסוג נקבע לפי
// תוכן הקובץ (lib/staff/sniff.ts), ותמיד יוצא אחד מהסוגים שהדלי מקבל.
const ALLOWED_PHOTO = ["image/jpeg", "image/png", "image/webp"]

function photoMime(raw: string) {
  const base = (raw || "").split(";")[0].trim().toLowerCase()
  return base === "image/jpg" ? "image/jpeg" : base || "image/jpeg"
}

export async function POST(req: Request) {
  const staff = await getStaff()
  if (!staff || staff.role === "display") return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // גוף גדול מהמותר נדחה לפי הכותרת, לפני שקוראים אותו לזיכרון (ביקורת שישית, ממצא 3)
  if (Number(req.headers.get("content-length") ?? "0") > MAX_AUDIO + MAX_PHOTO + 64 * 1024) return NextResponse.json({ error: "size" }, { status: 413 })
  const form = await req.formData().catch(() => null)
  const jobId = Number(form?.get("job_id"))
  const audioFile = form?.get("audio")
  const photoFile = form?.get("photo")
  const itemKey = String(form?.get("item") ?? "")
  const light = String(form?.get("light") ?? "")
  // הקלדה במקום הקלטה, או לצידה (סבב 2.10, ממצא 6). עד 1,000 תווים.
  const typed = String(form?.get("text") ?? "").trim().slice(0, 1000) || null

  const audio = audioFile instanceof Blob && audioFile.size > 0 ? audioFile : null
  const photo = photoFile instanceof Blob && photoFile.size > 0 ? photoFile : null

  if (!Number.isFinite(jobId) || (!audio && !photo && !typed)) return NextResponse.json({ error: "bad" }, { status: 400 })
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

  // סוג הקובץ לפי התוכן (ממצא 8): מה שלא מזוהה כתמונה או כקול לא נשמר ולא נשלח למודל.
  const photoBytes = photo ? Buffer.from(await photo.arrayBuffer()) : null
  const audioBytes = audio ? Buffer.from(await audio.arrayBuffer()) : null
  const photoType = photoBytes ? sniffPhoto(photoBytes) : null
  const audioType = audioBytes ? sniffAudio(audioBytes) : null
  if (photoBytes && !photoType) return NextResponse.json({ error: "photo" }, { status: 400 })
  if (audioBytes && !audioType) return NextResponse.json({ error: "audio" }, { status: 400 })
  // מכסת העלאות לפני השמירה. מכסת הניתוח (למטה) נבדקת אחרי, כדי שהקלטה תישמר גם כשהניתוח מחכה.
  const files = (photoBytes ? 1 : 0) + (audioBytes ? 1 : 0)
  if (files > 0 && !(await staffUploadAllowed(staff.id, files))) {
    return NextResponse.json({ error: "upload-limit", saved: false }, { status: 429 })
  }

  if (photo && photoBytes && photoType) {
    const mime = photoType
    const bytes = photoBytes
    const path = `${base}-p0.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`
    const up = await supabase.storage.from("job-media").upload(path, bytes, { contentType: mime, upsert: false })
    if (up.error) console.error("capture photo upload failed:", up.error.message)
    else saved.push({ path, kind: "photo", mime, bytes })
  }
  if (audio && audioBytes && audioType) {
    const mime = audioType
    const bytes = audioBytes
    const path = `${base}.${{ "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav" }[mime] ?? "webm"}`
    const up = await supabase.storage.from("job-media").upload(path, bytes, { contentType: mime, upsert: false })
    if (up.error) console.error("capture audio upload failed:", up.error.message)
    else saved.push({ path, kind: "audio", mime, bytes })
  }
  // טקסט בלבד הוא לכידה תקינה, בלי קובץ. רק כשניסינו להעלות ונכשלנו זו שגיאה.
  if (saved.length === 0 && (audio || photo)) return NextResponse.json({ error: "upload" }, { status: 502 })

  if (saved.length) {
    const { error: mediaError } = await supabase.from("media").insert(
      saved.map((m) => ({
        job_card_id: job.id,
        kind: m.kind,
        storage_path: m.path,
        mime: m.mime,
        bytes: m.bytes.length,
        created_by: staff.id,
      })),
    )
    // בלי שורה ב-media הקובץ יתום: אף מסך לא מראה אותו ואף אחד לא ימחק אותו. מוחקים מיד (056).
    if (mediaError) {
      console.error("capture media insert failed:", mediaError.message)
      await supabase.storage.from("job-media").remove(saved.map((m) => m.path))
      return NextResponse.json({ error: "save", saved: false }, { status: 502 })
    }
  }

  const a = saved.find((m) => m.kind === "audio")
  const p = saved.find((m) => m.kind === "photo")

  // מכסה (ממצא 7), אחרי השמירה: ההקלטה לא אובדת, ודניאל יכול לנסות שוב מהכרטיס.
  if (!(await staffAiAllowed(staff.id))) return NextResponse.json({ error: "limit", saved: saved.length > 0 }, { status: 429 })

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
      typed,
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
    // מה שהוקלד לא נשמר כקובץ, ולכן אין "לנסות שוב" — טיוטה ישירות מהטקסט, בלי
    // המודל. דניאל מקבל את מה שהמכונאי כתב, וממשיך ממנו כמו מכל טיוטה.
    if (typed) {
      const urgency = light === "red" ? "red" : "yellow"
      const { data: f } = await supabase
        .from("findings")
        .insert({
          job_card_id: job.id,
          source: item ? "intake" : "voice",
          transcript: typed,
          title: item ? item.label : typed.slice(0, 60),
          summary: typed,
          customer_text: typed,
          urgency,
          safety: Boolean(item?.safety),
          red_list: false,
          model: "typed",
          created_by: staff.id,
          status: "draft",
        })
        .select("id")
        .single()
      if (f) {
        if (saved.length) await supabase.from("media").update({ finding_id: f.id }).in("storage_path", saved.map((m) => m.path))
        if (item) await supabase.rpc("set_inspection_item", { p_job_id: job.id, p_key: item.key, p_light: light, p_finding_id: f.id })
        else await supabase.from("job_cards").update({ status: "waiting_quote" }).eq("id", job.id).in("status", ["open", "in_progress"])
        return NextResponse.json({ ok: true, finding_id: f.id, title: item ? item.label : typed.slice(0, 60), red_list: false, urgency })
      }
    }
    // הקבצים שמורים, ולכן אפשר לנסות שוב מהכרטיס בלי לבקש מהמכונאי לדבר שוב.
    return NextResponse.json({ error: "model", saved: true }, { status: 502 })
  }
}
