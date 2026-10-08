"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getStaff, requireStaff, requireManager, screenPath } from "@/lib/staff/session"
import { bookingContact, jobContact } from "@/lib/staff/contacts"
import { notifyReady, notifyRequest, sendDueReminders } from "@/lib/staff/notify"
import { INSPECTION_ITEMS, progress, type InspectionState, type Light } from "@/lib/staff/inspection"
import { quoteEmail, requestEmail, type QuoteReason, type QuoteSnapshot } from "@/lib/staff/quote"
import { sendEmail } from "@/lib/staff/email"
import { ACTIVE } from "@/lib/staff/queue"
import { isUpcoming, realEmail, releaseCalSlot } from "@/lib/staff/cal"

// כל הפעולות של אזור הצוות עוברות כאן. הן רצות בשרת בזהות של המשתמש המחובר,
// ולכן ה-RLS והפונקציות במסד אוכפים אותן שוב, גם אם מישהו יקרא להן ישירות.

// הטופס עובד גם בלי JavaScript: הוא נשלח לשרת, והשגיאה חוזרת בכתובת.
// זה חשוב במוסך, על טלפון ישן ועל רשת איטית.
export async function signIn(formData: FormData) {
  const email = String(formData.get("email") || "").trim()
  const password = String(formData.get("password") || "")
  if (!email || !password) redirect("/staff/login?e=1")

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    // בלוג של השרת רואים למה באמת. למשתמש אומרים הודעה אחת לכל סוגי הכישלון,
    // כדי לא להסגיר אילו כתובות קיימות.
    console.error("staff sign-in failed:", error.status, error.code, error.message)
    redirect("/staff/login?e=1")
  }

  // מכונאי נוחת ישר על הליפט שלו: זה כל המסך שהוא צריך. דניאל נוחת על הלוח,
  // ומשתמש של מסך תלוי נוחת על המסך שלו ולא זז משם.
  const staff = await getStaff()
  if (staff?.role === "display") redirect(screenPath(staff))
  redirect(staff?.role === "mechanic" ? "/staff/lift" : "/staff")
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/staff/login")
}

/**
 * קבלת רכב בדלפק: נפתח כרטיס, נרשמת הצעת המחיר הראשונה לשירות שהוזמן, והיא
 * יוצאת ללקוח במייל (ס' 132(ב): "במסמך מודפס או בהודעת דואר אלקטרוני").
 * בלי מייל — ההצעה מודפסת בדלפק, ונרשמת גרסה מודפסת.
 *
 * האישור של ההצעה הזו, כולל האבחון, מגיע מהלקוח עצמו (036, רועי 2.10): קישור
 * לאישור בוואטסאפ ובמייל, או חתימה על עותק מודפס ללקוח בלי סמארטפון. עד אז
 * הרכב בחניה, והמסד לא נותן להעלות אותו לליפט. קודם זה היה V של דניאל בלבד.
 */
export async function receiveCar(formData: FormData) {
  const staff = await requireManager()
  const bookingId = Number(formData.get("booking_id"))
  // כמה עבודות בקבלה אחת (רועי, 30.9: "הכנה לטסט וגם טיפול"). כל שורה: "מזהה:סוג-חלק".
  const lines = formData
    .getAll("line")
    .map((v) => String(v).split(":"))
    .map(([id, c]) => ({ id: Number(id), choice: c === "aftermarket" ? ("aftermarket" as const) : ("original" as const) }))
    .filter((l, i, all) => l.id > 0 && all.findIndex((x) => x.id === l.id) === i)
  const printCopy = formData.get("print_copy") === "on"
  const odometer = Number(String(formData.get("odometer") || "").replace(/\D/g, "")) || null
  const email = realEmail(String(formData.get("email") || "").trim().toLowerCase())
  const consent = formData.get("consent") === "on"
  const explained = formData.get("explained") === "on"
  // לקוח בלי סמארטפון: חותם על עותק מודפס, ודניאל רושם את החתימה אחר כך.
  const onPaper = formData.get("on_paper") === "on"
  if (!bookingId || lines.length === 0) redirect(`/staff/arrive/${bookingId}?e=missing`)
  // ס' 131: הסבר על ההבדל בין סוגי החלקים, לפני ההצעה. דניאל מאשר שהסביר.
  if (!explained) redirect(`/staff/arrive/${bookingId}?e=explain`)

  const supabase = await createClient()
  const [{ data: booking }, { data: picked }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, status, plate, customer_name, whatsapp_consent, vehicle_make, vehicle_model, vehicle_year, engine_code, fuel")
      .eq("id", bookingId)
      .maybeSingle(),
    supabase.from("price_list").select("*").in("id", lines.map((l) => l.id)),
  ])
  if (!booking || !picked || picked.length !== lines.length) redirect(`/staff/arrive/${bookingId}?e=missing`)
  if (booking.status === "arrived") redirect("/staff")
  // ס' 132(ב): קישור לאישור רק למי שהסכים לעדכונים אלקטרוניים. בלי הסכמה — עותק מודפס וחתימה.
  if (!onPaper && !consent && !booking.whatsapp_consent) redirect(`/staff/arrive/${bookingId}?e=paper`)

  const { data: job, error } = await supabase
    .from("job_cards")
    .insert({
      booking_id: booking.id,
      plate: booking.plate,
      vehicle_make: booking.vehicle_make,
      vehicle_model: booking.vehicle_model,
      vehicle_year: booking.vehicle_year,
      engine_code: booking.engine_code,
      fuel: booking.fuel,
      customer_name: booking.customer_name,
      // הטלפון מהתור, דרך המסד (062): העמודה לא נקראת ישירות
      customer_phone: (await bookingContact(supabase, booking.id)).customer_phone,
      customer_email: email,
      odometer_km: odometer,
      whatsapp_consent: consent || (booking.whatsapp_consent ?? false),
      updates_consent_at: consent ? new Date().toISOString() : null,
      // תקנה 8: לא מתחילים עבודה שהלקוח לא אישר, גם לא אבחון. האישור מגיע מהלקוח (036).
      work_approved_at: null,
      lift: null,
      status: "open",
      opened_by: staff.id,
    })
    .select("id")
    .single()
  if (error || !job) redirect(`/staff/arrive/${bookingId}?e=failed`)

  await supabase.from("quote_items").insert(
    lines.map((l) => {
      const item = picked.find((i) => i.id === l.id)!
      return {
        job_card_id: job.id,
        price_list_id: item.id,
        title: item.title,
        labor_hours: item.labor_hours,
        price_original: item.price_original,
        price_aftermarket: item.price_aftermarket,
        warranty_original: item.warranty_original,
        warranty_aftermarket: item.warranty_aftermarket,
        part_diff: item.part_diff,
        single_reason: item.single_reason,
        part_choice: l.choice === "aftermarket" && item.price_aftermarket !== null ? "aftermarket" : "original",
        created_by: staff.id,
      }
    }),
  )
  await supabase.from("bookings").update({ status: "arrived" }).eq("id", booking.id)

  // הקישור לאישור: אותו דף ואותה הודעת בוט כמו בממצאים. המייל של ההצעה מקבל אותו כפתור.
  let approveToken: string | null = null
  let requestId: number | null = null
  if (!onPaper) {
    const { data: token, error: reqError } = await supabase.rpc("send_intake_request", { p_job_id: job.id })
    if (reqError || !token) console.error("send_intake_request failed:", reqError?.code, reqError?.message)
    else {
      approveToken = String(token)
      // 045: הטוקן לא נקרא ישירות מהטבלה; פונקציה שבודקת שזה דניאל או אבי.
      const { data: rid } = await supabase.rpc("request_id_by_token", { p_token: approveToken })
      requestId = rid ? Number(rid) : null
    }
  }

  const outcome = await issueQuote(job.id, "intake", email ? "email" : "print", approveToken)
  if (requestId) await notifyRequest(supabase, requestId, "intake")

  revalidatePath("/staff")
  revalidatePath("/staff/floor")
  revalidatePath("/staff/lift")
  // בלי מייל, חתימה על נייר, או כשהלקוח רוצה גם דף ביד: דף ההדפסה, ומשם חזרה ללוח.
  // 1.2.0: הלוח צריך לדעת אם יצא קישור או שהלקוח חותם על נייר, גם אחרי ההדפסה.
  const intakeWay = onPaper ? "paper" : approveToken ? "link" : "failed"
  if (outcome === "print" || printCopy || onPaper) redirect(`/staff/job/${job.id}/quote?print=1&then=board&intake=${intakeWay}`)
  // דניאל בדלפק ממשיך ללקוח הבא (רועי, 30.9), ולא נשאר בכרטיס.
  redirect(`/staff?received=${encodeURIComponent(booking.plate)}&quote=${outcome}&intake=${approveToken ? "link" : "failed"}`)
}

/**
 * מוציא גרסה של ההצעה: רושם אותה (שנה, ס' 132(ג)), ושולח במייל אם צריך.
 * מחזיר מה קרה, כדי שהמסך יגיד לדניאל את האמת: נשלח, נכשל, או להדפיס.
 */
async function issueQuote(jobId: number, reason: QuoteReason, channel: "email" | "print", approveToken: string | null = null) {
  const supabase = await createClient()
  // במסד "resend" הוא עדכון; ההבדל רק בנוסח המייל.
  const { data, error } = await supabase.rpc("start_quote_version", {
    p_job_id: jobId,
    p_reason: reason === "intake" ? "intake" : "update",
    p_channel: channel,
  })
  if (error || !data) {
    console.error("start_quote_version failed:", error?.code, error?.message)
    return "failed" as const
  }
  if (channel === "print") return "print" as const

  const v = data as { id: number; version: number; email: string | null; snapshot: QuoteSnapshot }
  const sent = await sendEmail(v.email, quoteEmail(v.snapshot, v.version, reason, approveToken))
  await supabase.rpc("finish_quote_version", {
    p_id: v.id,
    p_status: sent.ok ? "sent" : "failed",
    p_error: sent.ok ? null : `${sent.reason}${!sent.ok && sent.detail ? `: ${sent.detail}` : ""}`,
  })
  if (sent.ok) return "sent" as const
  return sent.reason === "not_configured" ? ("noemail" as const) : ("failed" as const)
}

// ------------------------------------------------- אישור ההצעה של הקבלה (036)

/** הלקוח חתם בדלפק על העותק המודפס (לקוח בלי סמארטפון). מאותו רגע הרכב יכול לעלות לליפט. */
export async function markIntakeSigned(formData: FormData) {
  await requireManager()
  const jobId = Number(formData.get("job_id"))
  if (!jobId) return
  const supabase = await createClient()
  await supabase.rpc("mark_intake_signed", { p_job_id: jobId })
  revalidatePath("/staff")
  revalidatePath("/staff/floor")
  revalidatePath("/staff/lift")
  revalidatePath(`/staff/job/${jobId}`)
}

/**
 * שולח שוב את הקישור לאישור הקבלה: אותו קישור אם עוד בתוקף, חדש אם פג.
 * וואטסאפ (דרך הבוט) ומייל עם ההצעה.
 */
export async function resendIntakeRequest(formData: FormData) {
  await requireManager()
  const jobId = Number(formData.get("job_id"))
  if (!jobId) return
  // 1.2.0: מהלוח חוזרים ללוח (דניאל בדלפק ממשיך), מהכרטיס חוזרים לכרטיס.
  const back = (result: string) =>
    formData.get("from") === "board" ? `/staff?intake_resent=${result}` : `/staff/job/${jobId}?intake=${result}`
  const supabase = await createClient()
  const { data: token, error } = await supabase.rpc("send_intake_request", { p_job_id: jobId })
  if (error || !token) {
    redirect(back(error?.hint === "law-132b" ? "consent" : "failed"))
  }
  const { data: rid } = await supabase.rpc("request_id_by_token", { p_token: String(token) })
  const req = rid ? { id: Number(rid) } : null
  const { customer_email } = await jobContact(supabase, jobId)
  if (customer_email) await issueQuote(jobId, "intake", "email", String(token))
  if (req) await notifyRequest(supabase, req.id, "intake")
  revalidatePath("/staff")
  revalidatePath(`/staff/job/${jobId}`)
  redirect(back("sent"))
}

/** שולח שוב את ההצעה במייל (גרסה חדשה), או רושם גרסה מודפסת. */
export async function reissueQuote(formData: FormData) {
  await requireManager()
  const jobId = Number(formData.get("job_id"))
  const channel = formData.get("channel") === "print" ? "print" : "email"
  if (!jobId) return
  const outcome = await issueQuote(jobId, "resend", channel)
  revalidatePath(`/staff/job/${jobId}`)
  redirect(channel === "print" ? `/staff/job/${jobId}/quote?print=1` : `/staff/job/${jobId}?quote=${outcome}`)
}

// ---------------------------------------------------------------- ממצאים שעוד לא נשלחו

/**
 * יש ממצאים שדניאל עוד לא שלח? הכרטיס "מחכה לשליחה" (waiting_quote).
 * בלי זה, רכב שירד לחניה עם טיוטות נראה בלוח כאילו הלקוח כבר אישר
 * ("הלקוח אישר: להחזיר לתור"), כי הלוח מסיק את זה מהמצב (סבב 2.10, ממצא 9).
 * נקרא בסיום האבחון ובהורדה לחניה; ממצא קולי מהליפט כבר עושה את זה בעצמו.
 */
async function markWaitingIfDrafts(supabase: Awaited<ReturnType<typeof createClient>>, jobId: number) {
  const { count } = await supabase
    .from("findings")
    .select("id", { count: "exact", head: true })
    .eq("job_card_id", jobId)
    .eq("status", "draft")
  if (count) {
    await supabase.from("job_cards").update({ status: "waiting_quote" }).eq("id", jobId).in("status", ["open", "in_progress"])
  }
}

// ---------------------------------------------------------------- בדיקת הכניסה

/** סימון פריט באבחון: ירוק, צהוב או אדום. */
export async function setInspectionItem(formData: FormData) {
  const staff = await requireStaff()
  const jobId = Number(formData.get("job_id"))
  const key = String(formData.get("item") || "")
  const light = String(formData.get("light") || "") as Light
  if (!jobId || !INSPECTION_ITEMS.some((i) => i.key === key) || !["green", "yellow", "red"].includes(light)) return

  // פקודה אחת במסד (027). קודם: קריאה של כל הרשימה ושמירה שלה, וכך לחיצה על פריט
  // אחד דרסה הקלטה של פריט אחר שעוד עובדה (נוזלים, 30.9). ירוק מבטל את הטיוטה של הפריט.
  const supabase = await createClient()
  await supabase.rpc("set_inspection_item", { p_job_id: jobId, p_key: key, p_light: light })

  revalidatePath(`/staff/inspect/${jobId}`)
  revalidatePath(`/staff/job/${jobId}`)
}

/** סיום האבחון. רק כשכל הפריטים סומנו — אחרת זה לא אבחון, זה ניחוש. */
export async function completeInspection(formData: FormData) {
  const staff = await requireStaff()
  const jobId = Number(formData.get("job_id"))
  if (!jobId) return

  const supabase = await createClient()
  const { data: ins } = await supabase.from("inspections").select("items").eq("job_card_id", jobId).maybeSingle()
  const items = (ins?.items as InspectionState) ?? {}
  // כל צהוב או אדום צריך תיעוד (צילום ודיבור): בלעדיו דניאל לא יודע מה להציע.
  const undocumented = Object.values(items).some((s) => (s.light === "yellow" || s.light === "red") && !s.finding_id)
  if (!progress(items).complete || undocumented) redirect(`/staff/inspect/${jobId}?e=incomplete`)

  const now = new Date().toISOString()
  await supabase.from("inspections").update({ completed_at: now }).eq("job_card_id", jobId)
  await supabase.from("job_cards").update({ inspected_at: now, inspected_by: staff.id }).eq("id", jobId)
  await markWaitingIfDrafts(supabase, jobId)

  revalidatePath("/staff")
  revalidatePath("/staff/floor")
  revalidatePath("/staff/lift")
  redirect("/staff/lift")
}

// ---------------------------------------------------------------- קריאות מהעמדה

/** "דניאל, בוא לעמדה" או "סיימתי". לחיצה כפולה לא יוצרת קריאה שנייה (המסד). */
export async function callManager(formData: FormData) {
  const staff = await requireStaff()
  const jobId = Number(formData.get("job_id"))
  const kind = formData.get("kind") === "done" ? "done" : "help"
  if (!jobId) return

  const supabase = await createClient()
  const { data: job } = await supabase.from("job_cards").select("lift, plate").eq("id", jobId).maybeSingle()
  await supabase.from("help_calls").insert({ job_card_id: jobId, lift: job?.lift ?? staff.lift, requested_by: staff.id, kind })

  // "סיימתי" מפנה את הליפט מיד (רועי, 2.10). הרכב יורד לחניה, "גמור, מחכה
  // לבדיקה", ודניאל בודק על הקרקע ומסמן "מוכן" מתי שהוא פנוי. עד 2.10 הרכב
  // נשאר על הליפט עד הבדיקה, והליפט חיכה לבן אדם.
  if (kind === "done") {
    const now = new Date().toISOString()
    let done = supabase
      .from("job_cards")
      .update({ lift: null, parked_at: now, work_done_at: now })
      .eq("id", jobId)
      .not("lift", "is", null)
      .in("status", [...ACTIVE])
    // 043: מכונאי מסיים רק את הרכב שעל הליפט שלו.
    if (staff.role === "mechanic") done = done.eq("lift", staff.lift ?? -1)
    await done
    revalidatePath("/staff/floor")
    revalidatePath("/wall")
    revalidatePath("/staff")
    // אישור למכונאי: הרכב נעלם מהמסך, וצריך לדעת שזה נקלט (צילומי המדריך, 2.10).
    redirect(`/staff/lift?done=${encodeURIComponent(job?.plate ?? "")}`)
  }

  revalidatePath("/staff/lift")
  revalidatePath("/staff")
}

/** דניאל הגיע, או טיפל ב"סיימתי". */
export async function resolveCall(formData: FormData) {
  const staff = await requireManager()
  const id = Number(formData.get("call_id"))
  if (!id) return
  const supabase = await createClient()
  await supabase.from("help_calls").update({ resolved_at: new Date().toISOString(), resolved_by: staff.id }).eq("id", id)
  revalidatePath("/staff")
  revalidatePath("/staff/lift")
}

export type AnswerResult = { error?: string; ok?: string } | null

/**
 * "הגעתי" על מסך העמדה (026): דניאל, ליד הליפט, מקיש את הקוד שלו על המכשיר של
 * המכונאי. המכונאי לא יכול לסגור את הקריאה בעצמו, כי בלי הקוד המסד מסרב.
 */
export async function answerCall(_prev: AnswerResult, formData: FormData): Promise<AnswerResult> {
  await requireStaff()
  const callId = Number(formData.get("call_id"))
  const staffId = String(formData.get("staff_id") || "")
  const pin = String(formData.get("pin") || "").replace(/\D/g, "")
  if (!callId || !staffId) return { error: "צריך לבחור מי הגיע." }
  if (pin.length !== 6) return { error: "הקוד הוא 6 ספרות." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("answer_call_with_pin", { p_call_id: callId, p_staff_id: staffId, p_pin: pin })
  const r = data as { ok: boolean; reason?: string; left?: number; name?: string } | null
  if (error || !r) return { error: "לא נשמר. לנסות שוב." }
  if (!r.ok) {
    if (r.reason === "locked") return { error: "הקוד ננעל ל-15 דקות, אחרי 5 טעויות. בלוח היום עדיין אפשר ללחוץ \"הגעתי\"." }
    if (r.reason === "pin") return { error: `קוד שגוי. נשארו ${r.left ?? 0} ניסיונות.` }
    return { error: "אין לו קוד. קובעים קוד במסך העמדות." }
  }
  revalidatePath("/staff/lift")
  revalidatePath("/staff")
  return { ok: `${r.name ?? "דניאל"} כאן.` }
}

/** ליקוי בטיחותי שהלקוח דחה: סימון שדווח לרשות הרישוי (תקנה 6). */
export async function markSafetyReported(formData: FormData) {
  const staff = await requireManager()
  const id = Number(formData.get("finding_id"))
  if (!id) return
  const supabase = await createClient()
  await supabase
    .from("findings")
    .update({ safety_reported_at: new Date().toISOString(), safety_reported_by: staff.id })
    .eq("id", id)
    .eq("status", "declined")
  revalidatePath("/staff")
}

/** מעדכן מצב של כרטיס: בעבודה, ממתין לתשובה, מוכן, נמסר. */
export async function setJobStatus(formData: FormData) {
  // 043: "מוכן", "נמסר" ו"חזרה לעבודה" הם של דניאל ואבי. מכונאי לוחץ "סיימתי"
  // בעמדה, ודניאל בודק. המסד חוסם את זה שוב (job_cards_guard).
  const staff = await requireManager()
  const id = Number(formData.get("job_id"))
  const status = String(formData.get("status") || "")
  if (!id || !["in_progress", "waiting_quote", "ready", "delivered", "cancelled"].includes(status)) return

  const supabase = await createClient()
  // "הרכב מוכן" רק אחרי האבחון, ורק כשלא נשאר ממצא שמחכה לדניאל או ללקוח: אותה
  // בדיקה כמו הכפתור בכרטיס, עכשיו לכל הכפתורים (בלוח, במפה ובכרטיס). בלי זה
  // "בדקתי · הרכב מוכן" שלח ללקוח "מוכן" כשעוד חיכה לו קישור לאישור.
  if (status === "ready") {
    const [{ data: card }, { count: open }] = await Promise.all([
      supabase.from("job_cards").select("inspected_at").eq("id", id).maybeSingle(),
      supabase.from("findings").select("id", { count: "exact", head: true }).eq("job_card_id", id).in("status", ["draft", "sent"]),
    ])
    if (!card?.inspected_at || (open ?? 0) > 0) redirect(`/staff/job/${id}?ready=${card?.inspected_at ? "open" : "inspect"}`)
  }
  const patch: Record<string, unknown> = { status }
  if (status === "ready") {
    patch.ready_at = new Date().toISOString()
    // סיום טיפול מפנה את התא. הרכב יוצא לחצר וממתין ללקוח, והליפט חוזר
    // לתור: זה מה שמאפשר לרכב הבא לעלות. בלי זה התא נשאר "תפוס" על הנייר
    // עד שמישהו נזכר לשחרר אותו ידנית, וזה אף פעם לא קורה.
    patch.lift = null
  }
  if (status === "delivered") patch.delivered_at = new Date().toISOString()

  const { error } = await supabase.from("job_cards").update(patch).eq("id", id)
  // המסד בודק את אותו כלל שוב (054): אם בין הבדיקה למעלה לשמירה נוסף ממצא, ההודעה זהה.
  if (error?.hint === "ready-inspect" || error?.hint === "ready-open")
    redirect(`/staff/job/${id}?ready=${error.hint === "ready-inspect" ? "inspect" : "open"}`)

  // "מוכן" או "נמסר" סוגרים את "סיימתי" ו"בוא לעמדה" של הרכב הזה. בלי זה
  // "קוראים לך: סיים את העבודה" נשארה בלוח גם אחרי המסירה (סבב 2.10, ממצא 16).
  if (!error && (status === "ready" || status === "delivered" || status === "cancelled")) {
    await supabase
      .from("help_calls")
      .update({ resolved_at: new Date().toISOString(), resolved_by: staff.id })
      .eq("job_card_id", id)
      .is("resolved_at", null)
  }

  // הלקוח יודע שהרכב מוכן בלי להתקשר. המסד בודק שוב שהכרטיס באמת "מוכן",
  // שיש הסכמה ושלא נשלח כבר, ולכן אין כאן בדיקות משלנו.
  if (!error && status === "ready") await notifyReady(supabase, id)

  // 3.10 (ממצאים 1 ו-12): רכב שהגיע לפני מועד התור שלו. כשהוא נמסר, המועד
  // המקורי מתפנה ביומן ללקוח אחר. דווקא במסירה ולא בקבלה (רועי): "האירוע בוטל"
  // במייל של Cal.com מבלבל כשהרכב עוד במוסך. מועד שכבר עבר — לא נוגעים.
  if (!error && status === "delivered") {
    const { data: job } = await supabase.from("job_cards").select("booking_id").eq("id", id).maybeSingle()
    if (job?.booking_id) {
      const { data: b } = await supabase.from("bookings").select("cal_uid, drop_off_at").eq("id", job.booking_id).maybeSingle()
      if (b?.cal_uid && isUpcoming(b.drop_off_at)) await releaseCalSlot(b.cal_uid)
    }
  }

  revalidatePath("/staff")
  revalidatePath("/staff/floor")
  revalidatePath("/staff/lift")
  revalidatePath(`/staff/job/${id}`)
}

/** שולח שוב הודעת "מוכן" שנכשלה. המסד מאפשר זאת רק להודעה שנכשלה. */
export async function resendReadyNotice(formData: FormData) {
  await requireManager()
  const id = Number(formData.get("job_id"))
  if (!id) return

  const supabase = await createClient()
  await notifyReady(supabase, id)

  revalidatePath(`/staff/job/${id}`)
}

/** מעלה רכב שממתין לליפט פנוי, או מוריד אותו ממנו. */
export async function assignLift(formData: FormData) {
  // 043: דניאל ואבי משבצים. מכונאי מושך לליפט שלו בלבד ("למשוך לליפט", takeCar).
  await requireManager()
  const id = Number(formData.get("job_id"))
  const raw = String(formData.get("lift") || "")
  const lift = raw === "" ? null : Number(raw)
  if (!id || (lift !== null && ![1, 2, 3, 4].includes(lift))) return

  const supabase = await createClient()
  // האבחון נעשה על הליפט (רועי, 28.9): בלמים, נזילות והיגוי צריכים רכב מורם.
  if (lift !== null) {
    const { data: job } = await supabase.from("job_cards").select("status").eq("id", id).maybeSingle()
    if (!job) return
    await supabase
      .from("job_cards")
      .update({ lift, ...(job.status === "open" ? { status: "in_progress" } : {}) })
      .eq("id", id)
  } else {
    await supabase.from("job_cards").update({ lift }).eq("id", id)
  }

  revalidatePath("/staff")
  revalidatePath("/staff/floor")
  revalidatePath("/staff/lift")
}

export type SendResult = { ok: true } | { ok: false; error: string }

const LAW_ERRORS: Record<string, string> = {
  "law-132a": "חסרים מחיר, שעות עבודה או אחריות. החוק דורש את שלושתם בהצעה.",
  "law-131": "צריך להציע גם חלק חלופי ולהסביר את ההבדל, או לכתוב למה אין חלופה.",
  "law-132b": "הלקוח לא אישר בקבלה עדכונים באמצעים אלקטרוניים. צריך להתקשר או להדפיס.",
  // הנחה (020): הכללים של רועי, נאכפים במסד.
  "discount-reason": "הנחה צריכה סיבה. היא נרשמת, כדי שנדע בסוף החודש על מה הלך הכסף.",
  "discount-owner": "מעל 10% רק אבי. לבקש ממנו, או להוריד ל-10%.",
  "discount-role": "הנחה נותנים רק מנהל העבודה או הבעלים.",
  "discount-sent": "ההצעה כבר נשלחה ללקוח. אי אפשר לשנות לה את המחיר.",
  // בקשת הנחה מאבי (042).
  "discount-request-pct": "בקשה מאבי היא ל-15% עד 30%. עד 10% אפשר לתת לבד.",
  "discount-no-request": "הבקשה כבר טופלה, או שדניאל ביטל אותה. לרענן.",
  "discount-pending": "מחכה לאבי על ההנחה. כשהוא יענה, אפשר לשלוח.",
  message: "חסר נוסח ללקוח: מה נמצא, במילים שלו.",
  stale: "אחד הממצאים כבר נשלח או בוטל. לרענן ולנסות שוב.",
  empty: "צריך לסמן לפחות ממצא אחד.",
}

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[^\d.]/g, "")
  return s === "" ? null : Number(s)
}
const txt = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null

/**
 * שמירה של טיוטה אחת (027), בלי לשלוח. דניאל מתמחר כל ממצא, וכשכולם מוכנים
 * הוא שולח את כולם יחד (sendQuoteRequest). המחירים כאן הם מחירי המחירון,
 * וההנחה מחושבת מהם במסד (020); לכן שמירה חוזרת לא מורידה הנחה פעמיים.
 */
export async function saveFinding(formData: FormData): Promise<SendResult> {
  await requireManager()
  const findingId = Number(formData.get("finding_id"))
  const jobId = Number(formData.get("job_id"))
  if (!findingId) return { ok: false, error: "חסר ממצא." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("findings")
    .update({
      customer_text: txt(formData.get("message")),
      title: txt(formData.get("title")),
      price_list_id: num(formData.get("price_list_id")),
      // 030: המחירים והשעות כבר מוכפלים בכמות בטופס; הכמות נשמרת כדי לחזור למחיר ליחידה.
      quantity: Math.min(20, Math.max(1, Math.round(num(formData.get("quantity")) ?? 1))),
      price_original: num(formData.get("price_original")),
      price_aftermarket: num(formData.get("price_aftermarket")),
      list_price_original: num(formData.get("price_original")),
      list_price_aftermarket: num(formData.get("price_aftermarket")),
      discount_pct: num(formData.get("discount_pct")) ?? 0,
      discount_reason: txt(formData.get("discount_reason")),
      labor_hours: num(formData.get("labor_hours")),
      warranty_original: txt(formData.get("warranty_original")),
      warranty_aftermarket: txt(formData.get("warranty_aftermarket")),
      part_diff: txt(formData.get("part_diff")),
      single_reason: txt(formData.get("single_reason")),
      eta: txt(formData.get("eta")),
      safety: formData.get("safety") === "on",
    })
    .eq("id", findingId)
    .eq("status", "draft")
  if (error) return { ok: false, error: LAW_ERRORS[error.hint ?? ""] ?? "לא נשמר. לנסות שוב." }

  revalidatePath(`/staff/job/${jobId}`)
  return { ok: true }
}

/**
 * 042: הנחה מעל 10%. דניאל מבקש מתוך הממצא, ואבי מאשר או דוחה מהלוח שלו.
 * הבקשה, הסיבה ומי ביקש נבדקים ונרשמים במסד (request_discount, decide_discount).
 */
export async function requestDiscount(formData: FormData): Promise<SendResult> {
  await requireManager()
  const findingId = Number(formData.get("finding_id"))
  const jobId = Number(formData.get("job_id"))
  if (!findingId) return { ok: false, error: "חסר ממצא." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("request_discount", {
    p_finding_id: findingId,
    p_pct: num(formData.get("pct")),
    p_reason: txt(formData.get("reason")),
  })
  if (error) return { ok: false, error: LAW_ERRORS[error.hint ?? ""] ?? "הבקשה לא נשלחה. לנסות שוב." }
  revalidatePath("/staff")
  revalidatePath(`/staff/job/${jobId}`)
  return { ok: true }
}

export async function cancelDiscountRequest(formData: FormData): Promise<SendResult> {
  await requireManager()
  const findingId = Number(formData.get("finding_id"))
  const jobId = Number(formData.get("job_id"))
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_discount_request", { p_finding_id: findingId })
  if (error) return { ok: false, error: "לא בוטל. לנסות שוב." }
  revalidatePath("/staff")
  revalidatePath(`/staff/job/${jobId}`)
  return { ok: true }
}

export async function decideDiscount(formData: FormData) {
  await requireManager()
  const findingId = Number(formData.get("finding_id"))
  const jobId = Number(formData.get("job_id"))
  const supabase = await createClient()
  await supabase.rpc("decide_discount", { p_finding_id: findingId, p_approve: formData.get("approve") === "1" })
  revalidatePath("/staff")
  if (jobId) revalidatePath(`/staff/job/${jobId}`)
}

export type RequestState = { ok: true; count: number } | { ok: false; error: string } | null

/**
 * ההודעה האחת ללקוח (רועי, 30.9: "לא שולחים הודעה 5 פעמים. הכל מרוכז, על ידי דניאל").
 * כל הממצאים שדניאל סימן יוצאים כבקשה אחת: קישור אחד, הודעת וואטסאפ אחת, ומייל אחד.
 * המסד בודק כל ממצא לפי החוק; אם אחד חסר, לא יוצא כלום, וההודעה אומרת איזה.
 */
export async function sendQuoteRequest(_prev: RequestState, formData: FormData): Promise<RequestState> {
  await requireManager()
  const jobId = Number(formData.get("job_id"))
  const ids = [...new Set(formData.getAll("finding_id").map(Number).filter((n) => n > 0))]
  if (!jobId || ids.length === 0) return { ok: false, error: LAW_ERRORS.empty }

  const supabase = await createClient()
  // 042: ממצא שמחכה לאבי על הנחה לא יוצא ללקוח, כדי שהלקוח לא יקבל מחיר שעוד ישתנה.
  const { data: waiting } = await supabase.from("findings").select("title").in("id", ids).not("discount_request_at", "is", null).limit(1)
  if (waiting?.length) return { ok: false, error: `${waiting[0].title}: ${LAW_ERRORS["discount-pending"]}` }
  const { data: token, error } = await supabase.rpc("send_quote_request", { p_job_id: jobId, p_finding_ids: ids })
  if (error || !token) {
    const which = Number(error?.details)
    const { data: f } = which ? await supabase.from("findings").select("title").eq("id", which).maybeSingle() : { data: null }
    const why = LAW_ERRORS[error?.hint ?? ""] ?? "השליחה נכשלה. לנסות שוב."
    return { ok: false, error: f?.title ? `${f.title}: ${why}` : why }
  }

  const { data: rid } = await supabase.rpc("request_id_by_token", { p_token: String(token) })
  const req = rid ? { id: Number(rid) } : null
  if (req) {
    const { data: rows } = await supabase.rpc("request_approval_tokens", { p_request_id: req.id })
    for (const a of rows ?? []) await sharePhotos(a.finding_id, a.token)
    await notifyRequest(supabase, req.id)
  }

  // לצד הוואטסאפ, מייל עם אותו קישור. לקוח שלא כתב לנו בוואטסאפ עדיין מקבל.
  const [{ data: job }, { data: fs }] = await Promise.all([
    supabase.from("job_cards").select("customer_name, plate, vehicle_make, vehicle_model").eq("id", jobId).single(),
    supabase.from("findings").select("title, safety, price_original, price_aftermarket").in("id", ids),
  ])
  const { customer_email } = await jobContact(supabase, jobId)
  if (job && customer_email) {
    try {
      await sendEmail(
        customer_email,
        requestEmail({
          customer: job.customer_name,
          plate: job.plate,
          vehicle: [job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || null,
          token: String(token),
          items: (fs ?? []).map((f) => ({
            title: f.title ?? "ממצא",
            safety: Boolean(f.safety),
            from:
              f.price_aftermarket !== null
                ? Math.min(Number(f.price_original), Number(f.price_aftermarket))
                : f.price_original === null
                  ? null
                  : Number(f.price_original),
          })),
        }),
      )
    } catch (e) {
      console.error("request email failed:", (e as Error).message)
    }
  }

  revalidatePath(`/staff/job/${jobId}`)
  revalidatePath("/staff")
  revalidatePath("/staff/floor")
  revalidatePath("/staff/lift")
  return { ok: true, count: ids.length }
}

/** ממצא שלא שולחים ללקוח: טעות, כפילות, או משהו שדניאל החליט לא להציע. */
export async function dismissFinding(formData: FormData) {
  await requireManager()
  const findingId = Number(formData.get("finding_id"))
  const jobId = Number(formData.get("job_id"))
  if (!findingId) return
  const supabase = await createClient()
  await supabase.from("findings").update({ status: "cancelled" }).eq("id", findingId).eq("status", "draft")
  // אם לא נשאר מה לשלוח ואין מה לחכות לו, הרכב חוזר לעבודה.
  const { count } = await supabase
    .from("findings")
    .select("id", { count: "exact", head: true })
    .eq("job_card_id", jobId)
    .in("status", ["draft", "sent"])
  if (!count) await supabase.from("job_cards").update({ status: "in_progress" }).eq("id", jobId).eq("status", "waiting_quote")
  revalidatePath(`/staff/job/${jobId}`)
  revalidatePath("/staff")
  revalidatePath("/staff/lift")
}

/**
 * התמונות של הממצא, לדף של הלקוח. הדלי של הכרטיסים פרטי והלקוח לא מחובר,
 * ולכן מעתיקים לדלי ציבורי בנתיב של הטוקן (אקראי, כמו הקישור עצמו).
 * כישלון כאן לא עוצר את השליחה: הלקוח יקבל את ההצעה גם בלי תמונה.
 */
async function sharePhotos(findingId: number, token: string) {
  const supabase = await createClient()
  const { data: photos } = await supabase
    .from("media")
    .select("storage_path, mime")
    .eq("finding_id", findingId)
    .eq("kind", "photo")
    .order("created_at", { ascending: true })
    .limit(6)

  const paths: string[] = []
  for (const [i, m] of (photos ?? []).entries()) {
    const file = await supabase.storage.from("job-media").download(m.storage_path)
    if (file.error || !file.data) continue
    const ext = m.mime === "image/png" ? "png" : m.mime === "image/webp" ? "webp" : "jpg"
    const path = `${token}/${i}.${ext}`
    const up = await supabase.storage
      .from("shared-quotes")
      .upload(path, Buffer.from(await file.data.arrayBuffer()), { contentType: m.mime || "image/jpeg", upsert: false })
    if (!up.error) paths.push(path)
  }
  if (paths.length) await supabase.rpc("set_approval_photos", { p_token: token, p_paths: paths })
}

/**
 * התזכורות למחר יוצאות לבד כל ערב. הכפתור הזה שולח אותן עכשיו — לתור שנקבע
 * אחרי המשימה של הערב, ולהדגמה. מי שכבר קיבל תזכורת לא יקבל שוב.
 */
export async function sendRemindersNow() {
  await requireManager()
  const run = await sendDueReminders()
  revalidatePath("/staff")
  redirect(`/staff?reminders=${run.sent}.${run.skipped}.${run.failed}.${run.due}`)
}

/** שולח שוב את הקישור לאישור, כשהשליחה בוואטסאפ נכשלה (לבקשה כולה). */
export async function resendRequestNotice(formData: FormData) {
  await requireManager()
  const requestId = Number(formData.get("request_id"))
  const jobId = Number(formData.get("job_id"))
  if (!requestId) return

  const supabase = await createClient()
  await notifyRequest(supabase, requestId)

  revalidatePath(`/staff/job/${jobId}`)
}

/**
 * מכונאי מושך לליפט שלו את הבא בתור. רכב שהורד לחניה ומחכה למשהו לא בתור:
 * דניאל מחזיר אותו (המסד אוכף את זה גם אם מישהו עוקף את הכפתור).
 */
export async function takeCar(formData: FormData) {
  const staff = await requireStaff()
  const id = Number(formData.get("job_id"))
  if (!id || !staff.lift) return

  const supabase = await createClient()
  const [{ data: job }, { data: onMyLift }] = await Promise.all([
    supabase.from("job_cards").select("status").eq("id", id).maybeSingle(),
    supabase.from("job_cards").select("id").eq("lift", staff.lift).in("status", [...ACTIVE]),
  ])
  // ליפט אחד, רכב אחד.
  if (!job || (onMyLift ?? []).length > 0) return
  await supabase
    .from("job_cards")
    .update({ lift: staff.lift, ...(job.status === "open" ? { status: "in_progress" } : {}) })
    .eq("id", id)
    .is("lift", null)
    .is("parked_at", null)

  revalidatePath("/staff/lift")
  revalidatePath("/staff")
  revalidatePath("/staff/floor")
}

// ---------------------------------------------------------------- הליפט לא מחכה


function revalidateFloor(jobId?: number) {
  revalidatePath("/staff")
  revalidatePath("/staff/floor")
  revalidatePath("/staff/lift")
  if (jobId) revalidatePath(`/staff/job/${jobId}`)
}

/**
 * להוריד מהליפט: הרכב מחכה ללקוח (או לחלק), ואין עליו עבודה מאושרת שנשארה.
 * הוא עובר לחניה ויוצא מהתור, והליפט עובר לבא בתור. כשהלקוח מאשר, דניאל
 * מחזיר אותו לתור — בראש התור, כי ללקוח הזה כבר הבטחנו.
 */
export async function lowerCar(formData: FormData) {
  const staff = await requireStaff()
  if (staff.role === "display") return
  const id = Number(formData.get("job_id"))
  // ביקורת UX, 8.10, ממצא 1: רק אחרי "כן, הרכב סגור ואפשר לנסוע בו" (components/staff/lower-car.tsx)
  if (!id || formData.get("fit") !== "yes") return
  const supabase = await createClient()
  await supabase
    .from("job_cards")
    .update({ lift: null, parked_at: new Date().toISOString() })
    .eq("id", id)
    .not("lift", "is", null)
    .in("status", [...ACTIVE])
  await markWaitingIfDrafts(supabase, id)
  revalidateFloor(id)
}

/** דניאל מחזיר לתור רכב שחיכה בחניה. הוא נכנס לראש התור. */
export async function requeueCar(formData: FormData) {
  await requireManager()
  const id = Number(formData.get("job_id"))
  if (!id) return
  const supabase = await createClient()
  await supabase
    .from("job_cards")
    .update({ parked_at: null, outside_at: null, work_done_at: null, priority_at: new Date().toISOString() })
    .eq("id", id)
    .is("lift", null)
    .in("status", [...ACTIVE])
  revalidateFloor(id)
}

/** דניאל מקדים רכב לראש התור. המכונאי הבא שיתפנה ימשוך אותו. */
export async function toFrontOfQueue(formData: FormData) {
  await requireManager()
  const id = Number(formData.get("job_id"))
  if (!id) return
  const supabase = await createClient()
  await supabase.from("job_cards").update({ priority_at: new Date().toISOString() }).eq("id", id).is("lift", null)
  revalidateFloor(id)
}

/** עבודה קטנה שלא צריכה ליפט: בחוץ, בחניה. */
export async function sendOutside(formData: FormData) {
  await requireManager()
  const id = Number(formData.get("job_id"))
  if (!id) return
  const supabase = await createClient()
  await supabase
    .from("job_cards")
    .update({ lift: null, parked_at: null, outside_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", [...ACTIVE])
  revalidateFloor(id)
}

export type PickResult = { ok: true; sent: boolean; why?: string } | { ok: false; error: string } | null

const PICK_WHY: Record<string, string> = {
  daniel: "נרשם, עם המחיר מהמחירון. דניאל שולח ללקוח הודעה אחת עם כל מה שנמצא.",
  exists: "זה כבר נרשם ברכב הזה.",
}

/**
 * ממצא מהמחירון, מהעמדה. נכנס לדניאל כבר מתומחר (כל השדות מהמחירון), והוא
 * שולח ללקוח הודעה אחת עם כל הממצאים (רועי, 30.9: "המכונאי לא שולח וואטסאפ ללקוח").
 * המכונאי לא מקליד מחיר, בשום מסלול.
 */
export async function addFromPriceList(_prev: PickResult, formData: FormData): Promise<PickResult> {
  const staff = await requireStaff()
  if (staff.role === "display") return { ok: false, error: "אין הרשאה." }
  const jobId = Number(formData.get("job_id"))
  const itemId = Number(formData.get("price_list_id"))
  if (!jobId || !itemId) return { ok: false, error: "צריך לבחור עבודה." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("add_price_list_finding", { p_job_id: jobId, p_price_list_id: itemId })
  if (error || !data) return { ok: false, error: "לא נרשם. לנסות שוב, או לקרוא לדניאל." }
  const r = data as { finding_id: number; sent: boolean; why?: string }

  revalidateFloor(jobId)
  return { ok: true, sent: r.sent, why: r.why ? PICK_WHY[r.why] : undefined }
}

/**
 * 3.10: רכב שהגיע בלי תור. דניאל פותח לו תור מהדלפק, ומשם זו אותה קבלה בדיוק.
 * פרטי הרכב ממאגר משרד התחבורה; אם המאגר איטי, ממשיכים בלעדיהם ולא מעכבים את
 * הלקוח בדלפק. ההסכמה לוואטסאפ לא מסומנת כאן: הלקוח שולח אותה בעצמו מה-QR
 * שבדף הקבלה, והתקנון מאושר בדף ההצעה (039).
 */
export async function createWalkin(formData: FormData) {
  await requireManager()
  const plate = String(formData.get("plate") || "").replace(/\D/g, "")
  const phone = String(formData.get("phone") || "").trim()
  const back = (e: string) => redirect(`/staff/walkin?e=${e}`)
  if (plate.length < 7 || plate.length > 8) back("plate")
  if (!/^(\+?972|0)\d{8,9}$/.test(phone.replace(/[^\d+]/g, ""))) back("phone")

  const { lookupPlate } = await import("@/lib/site/plate")
  const car = await Promise.race([
    lookupPlate(plate),
    new Promise<{ error: "upstream" }>((r) => setTimeout(() => r({ error: "upstream" }), 12_000)),
  ])
  const found = "found" in car && car.found ? car : null

  const supabase = await createClient()
  const { data: id, error } = await supabase.rpc("create_walkin_booking", {
    p: {
      plate,
      customer_phone: phone,
      customer_name: String(formData.get("name") || ""),
      customer_email: String(formData.get("email") || ""),
      service: String(formData.get("service") || "") || null,
      notes: String(formData.get("notes") || ""),
      vehicle_found: Boolean(found),
      vehicle_make: found?.make ?? null,
      vehicle_model: found?.model ?? null,
      vehicle_year: found?.year ?? null,
      engine_code: found?.engine ?? null,
      fuel: found?.fuel ?? null,
      tires: found?.tires ?? null,
      test_valid_until: found?.testUntil ? String(found.testUntil).slice(0, 10) : null,
    },
  })
  if (error || !id) {
    console.error("walk-in failed:", error?.code, error?.message)
    back(error?.hint === "phone" ? "phone" : error?.hint === "plate" ? "plate" : "failed")
  }
  revalidatePath("/staff")
  redirect(`/staff/arrive/${id}?walkin=1`)
}
