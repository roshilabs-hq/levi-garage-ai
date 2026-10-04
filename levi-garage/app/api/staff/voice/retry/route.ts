import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStaff } from "@/lib/staff/session"
import { createFindingFromAudio } from "@/lib/staff/make-finding"

// ניסיון תמלול חוזר, על הקלטה ששמורה כבר.
//
// כשהמודל נופל, ההקלטה כן נשמרת — אבל עד כאן לא הייתה שום דרך להריץ אותה
// שוב, וההודעה שהמכונאי ראה ("דניאל יכול לנסות שוב מהכרטיס") הבטיחה כפתור
// שלא היה קיים. במוסך זה אומר שמכונאי נדרש לרדת מתחת לרכב ולדבר שוב, על
// משהו שכבר אמר.

export const maxDuration = 90

export async function POST(req: Request) {
  const staff = await getStaff()
  // 043: מסך תלוי (display) לא מתמלל.
  if (!staff || staff.role === "display") return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null)
  const mediaId = Number(body?.media_id)
  if (!Number.isFinite(mediaId)) return NextResponse.json({ error: "bad" }, { status: 400 })

  const supabase = await createClient()

  const { data: media } = await supabase
    .from("media")
    .select("id, job_card_id, kind, storage_path, mime, finding_id")
    .eq("id", mediaId)
    .maybeSingle()

  if (!media || media.kind !== "audio") return NextResponse.json({ error: "not found" }, { status: 404 })
  // כבר יש טיוטה מההקלטה הזאת. ניסיון חוזר היה יוצר כפילות שדניאל ישלח פעמיים.
  if (media.finding_id) return NextResponse.json({ error: "already" }, { status: 409 })

  const { data: job } = await supabase
    .from("job_cards")
    .select("id, plate, vehicle_make, vehicle_model, vehicle_year, engine_code")
    .eq("id", media.job_card_id)
    .maybeSingle()
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 })

  const file = await supabase.storage.from("job-media").download(media.storage_path)
  if (file.error || !file.data) {
    console.error("retry download failed:", file.error?.message)
    return NextResponse.json({ error: "download" }, { status: 502 })
  }

  try {
    // התמונה שצולמה יחד עם ההקלטה (אותה לכידה, בלי ממצא) עוברת גם היא.
    const { data: siblings } = await supabase
      .from("media")
      .select("storage_path, kind, mime, created_at")
      .eq("job_card_id", media.job_card_id)
      .is("finding_id", null)
      .eq("kind", "photo")
      .like("storage_path", `${media.storage_path.replace(/\.[a-z0-9]+$/, "")}%`)
    const photoPath = siblings?.[0]?.storage_path
    const photoFile = photoPath ? await supabase.storage.from("job-media").download(photoPath) : null

    const { finding_id, report } = await createFindingFromAudio({
      supabase,
      job,
      audio: { bytes: Buffer.from(await file.data.arrayBuffer()), mime: media.mime || "audio/webm" },
      photo: photoFile?.data ? { bytes: Buffer.from(await photoFile.data.arrayBuffer()), mime: siblings?.[0]?.mime || "image/jpeg" } : null,
      staffId: staff.id,
      mediaPaths: [media.storage_path, ...(photoPath ? [photoPath] : [])],
    })
    return NextResponse.json({ ok: true, finding_id, summary: report.summary, red_list: report.red_list })
  } catch (e) {
    console.error("retry report failed:", (e as Error).message)
    return NextResponse.json({ error: "model" }, { status: 502 })
  }
}
