import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStaff } from "@/lib/staff/session"
import { staffAiAllowed } from "@/lib/staff/ai-quota"
import { sniffPhoto } from "@/lib/staff/sniff"
import { INSPECTION_ITEMS, type InspectionState } from "@/lib/staff/inspection"
import { askMentor, type MentorTurn } from "@/lib/mentor/ask"

// "המוסכניק הוותיק" בעמדה (סבב 2.10). שאלה ← תשובה, עם ההקשר של הכרטיס, וכל שאלה
// ותשובה נשמרות (031). הדפדפן שולח רק את השאלה, מזהה הכרטיס, את השיחה עד עכשיו
// ותמונה אם צולמה. הרכב, מה הלקוח סיפר ומי שואל — מהמסד, לא מהדפדפן.

export const maxDuration = 90

const MAX_PHOTO = 8 * 1024 * 1024
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"]

export async function POST(req: Request) {
  const staff = await getStaff()
  if (!staff || staff.role === "display") return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const question = String(form?.get("question") ?? "").trim().slice(0, 2000)
  const jobId = Number(form?.get("job_id")) || null
  const photoFile = form?.get("photo")
  const photo = photoFile instanceof Blob && photoFile.size > 0 ? photoFile : null
  if (!question && !photo) return NextResponse.json({ error: "empty" }, { status: 400 })
  if (photo && (photo.size > MAX_PHOTO || !PHOTO_TYPES.includes((photo.type || "image/jpeg").split(";")[0]))) {
    return NextResponse.json({ error: "photo" }, { status: 400 })
  }

  // השיחה עד עכשיו: רק תפקיד וטקסט, עד 6 תורות.
  let history: MentorTurn[] = []
  try {
    const raw = JSON.parse(String(form?.get("history") ?? "[]"))
    if (Array.isArray(raw)) {
      history = raw
        .filter((t) => (t?.role === "user" || t?.role === "model") && typeof t?.text === "string")
        .slice(-6)
        .map((t) => ({ role: t.role, text: String(t.text).slice(0, 2000) }))
    }
  } catch {
    history = []
  }

  const supabase = await createClient()

  // ההקשר מהכרטיס. RLS מחזיר כרטיס רק לעובד; בלי כרטיס, העוזר עונה בלי רכב.
  let car = "לא ידוע"
  let year: number | null = null
  let engine: string | null = null
  let complaint: string | null = null
  let inspection: string | null = null
  if (jobId) {
    const { data: job } = await supabase
      .from("job_cards")
      .select("id, vehicle_make, vehicle_model, vehicle_year, engine_code, booking_id")
      .eq("id", jobId)
      .maybeSingle()
    if (job) {
      car = [job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "לא ידוע"
      year = job.vehicle_year
      engine = job.engine_code
      const [{ data: booking }, { data: ins }] = await Promise.all([
        job.booking_id
          ? supabase.from("bookings").select("service, notes").eq("id", job.booking_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("inspections").select("items").eq("job_card_id", job.id).maybeSingle(),
      ])
      complaint = [booking?.service, booking?.notes].filter(Boolean).join(" · ").slice(0, 400) || null
      const items = (ins?.items as InspectionState | null) ?? {}
      const marked = INSPECTION_ITEMS.filter((i) => items[i.key]?.light === "yellow" || items[i.key]?.light === "red").map(
        (i) => `${i.label} ${items[i.key]?.light === "red" ? "אדום" : "צהוב"}`,
      )
      inspection = marked.length ? marked.join(", ") : null
    }
  }

  // הסוג לפי התוכן (ממצא 8), ומכסה לפני הקריאה ל-Gemini (ממצא 7). ביקורת אבטחה חיצונית, 7.10.
  const photoBytes = photo ? Buffer.from(await photo.arrayBuffer()) : null
  const photoType = photoBytes ? sniffPhoto(photoBytes) : null
  if (photoBytes && !photoType) return NextResponse.json({ error: "photo" }, { status: 400 })
  if (!(await staffAiAllowed(staff.id))) return NextResponse.json({ error: "limit" }, { status: 429 })
  const pic = photoBytes && photoType ? { data: photoBytes.toString("base64"), mime: photoType } : null

  try {
    const out = await askMentor(
      question || "מה אתה רואה בתמונה?",
      { car, year, engine, complaint, inspection, asker: { name: staff.full_name, role: staff.role, lang: staff.lang } },
      history,
      pic,
    )
    // התיעוד שה-Gem לא נותן. כישלון בשמירה לא מבטל את התשובה למכונאי.
    const { error } = await supabase.from("mentor_questions").insert({
      job_card_id: jobId,
      asked_by: staff.id,
      question: question || "(תמונה בלבד)",
      had_photo: Boolean(photo),
      answer: out.answer,
      red_list: out.red_list,
      model: out.model,
    })
    if (error) console.error("mentor log failed:", error.message)
    return NextResponse.json({ ok: true, answer: out.answer, red_list: out.red_list })
  } catch (e) {
    console.error("mentor failed:", (e as Error).message)
    return NextResponse.json({ error: "model" }, { status: 502 })
  }
}
