import type { SupabaseClient } from "@supabase/supabase-js"

import { reportFromVoice, type ReportContext } from "@/lib/staff/voice-report"

// הקטע המשותף לשני המסלולים: לכידה חדשה, וניסיון חוזר על הקלטה שכבר שמורה.
//
// הוא יושב כאן ולא בכל אחד מהם, כי ניסיון חוזר שמריץ קוד אחר מההקלטה
// המקורית הוא לא ניסיון חוזר: הוא באג שמחכה לקרות.

type Job = {
  id: number
  plate: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_year: number | null
  engine_code: string | null
  status?: string
}

/**
 * מריץ את המודל על הקול והתמונה, ופותח מהם טיוטת ממצא בכרטיס.
 * `mediaPaths` מקשרים את הקבצים לטיוטה, כדי שדניאל והלקוח יראו את התמונה
 * של הממצא הזה — ולא את כל התמונות של הרכב.
 */
export async function createFindingFromAudio({
  supabase,
  job,
  audio,
  photo,
  staffId,
  mediaPaths,
  item,
  source = "voice",
  typed = null,
}: {
  supabase: SupabaseClient
  job: Job
  audio: { bytes: Buffer; mime: string } | null
  photo: { bytes: Buffer; mime: string } | null
  staffId: string
  mediaPaths: string[]
  item?: ReportContext["item"]
  source?: "voice" | "intake"
  /** מה שהמכונאי הקליד (סבב 2.10: "התיאור גם וגם"). */
  typed?: string | null
}) {
  const report = await reportFromVoice(
    audio ? { data: audio.bytes.toString("base64"), mime: audio.mime } : null,
    photo ? { data: photo.bytes.toString("base64"), mime: photo.mime } : null,
    {
      plate: job.plate,
      make: job.vehicle_make,
      model: job.vehicle_model,
      year: job.vehicle_year,
      engine: job.engine_code,
      item: item ?? null,
    },
    typed,
  )

  const { data: finding, error } = await supabase
    .from("findings")
    .insert({
      job_card_id: job.id,
      source,
      transcript: report.transcript,
      title: report.title,
      summary: report.summary,
      customer_text: report.customer_text,
      urgency: report.urgency,
      safety: report.safety,
      red_list: report.red_list,
      model: report.model,
      created_by: staffId,
      status: "draft",
    })
    .select("id")
    .single()

  if (error) throw new Error(`finding insert failed: ${error.message}`)

  if (mediaPaths.length) {
    await supabase.from("media").update({ finding_id: finding.id }).in("storage_path", mediaPaths)
  }

  // ממצא מהליפט עוצר את הרכב עד שדניאל שולח: זה הזמן שהלוח מודד ("מחכה
  // לשליחה"). ממצא מבדיקת הכניסה לא משנה מצב — הרכב עוד לא התחיל עבודה.
  if (source === "voice") {
    await supabase.from("job_cards").update({ status: "waiting_quote" }).eq("id", job.id).in("status", ["open", "in_progress"])
  }

  return { finding_id: finding.id as number, report }
}
