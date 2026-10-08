import type { SupabaseClient } from "@supabase/supabase-js"
import { nextPickup } from "@/lib/hours"

// "הרכב מוכן": ההודעה שמחליפה את 25–35 שיחות "מתי מוכן" ביום.
//
// רק הבוט מחזיק את קו הוואטסאפ, ולכן האתר לא שולח בעצמו — הוא מבקש מהבוט.
// הבוט מחליט על הנוסח, ושולח רק למי שכתב למוסך ב-14 הימים האחרונים (ראו
// lib/garage.js במאגר של הבוט). כאן: לתפוס את ההודעה במסד, לבקש, ולרשום מה קרה.
//
// כלום כאן לא זורק. כישלון בשליחה לא אמור לבטל את זה שהרכב מוכן: הכרטיס
// זז, והצוות רואה בכרטיס שההודעה לא יצאה ולמה.

const TIMEOUT_MS = 10_000

/** 050-1234567 או +972 50 123 4567 → 972501234567. כל דבר אחר: null. */
export function toWaNumber(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/\D/g, "")
  if (/^0\d{8,9}$/.test(d)) return `972${d.slice(1)}`
  if (/^972\d{8,9}$/.test(d)) return d
  return null
}

type Kind = "ready" | "quote" | "reminder"

type Claim = {
  id: number
  send: boolean
  phone?: string | null
  name?: string | null
  make?: string | null
  model?: string | null
  plate?: string | null
  token?: string | null
  at?: string | null
  uid?: string | null
}

type Outcome = { status: "sent" | "failed" | "skipped"; reason?: string }

async function ask(kind: Kind, claim: Claim, to: string, extra: Record<string, string> = {}): Promise<Outcome> {
  const url = process.env.GARAGE_NOTIFY_URL
  const token = process.env.GARAGE_NOTIFY_TOKEN
  if (!url || !token) return { status: "skipped", reason: "not_wired" }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-garage-notify-token": token },
      body: JSON.stringify({
        kind,
        to,
        // שם פרטי בלבד. ההודעה לא צריכה יותר, והבוט לא צריך לדעת יותר.
        name: String(claim.name ?? "").trim().split(/\s+/)[0] || "",
        car: [claim.make, claim.model].filter(Boolean).join(" "),
        plateTail: String(claim.plate ?? "").replace(/\D/g, "").slice(-3),
        // לקישור האישור: רק הטוקן. הבוט בונה את הכתובת בעצמו, על האתר שלנו.
        ...(kind === "quote" ? { token: claim.token } : {}),
        // לתזכורת: מתי, ומזהה התור ב-Cal.com. את הנוסח ואת הקישור לביטול הבוט בונה.
        ...(kind === "reminder" ? { at: claim.at, uid: claim.uid } : {}),
        // ל"מוכן": מתי אפשר לבוא, כנתונים ולא כטקסט — {when: today|tomorrow|day, from,
        // until, day}. הבוט בוחר את הנוסח הקבוע לפי זה (סבב 2.10, ממצא 17: בשישי
        // אחרי 12:00 נאמר ללקוחה "א׳–ה׳ עד 17:00"). בוט שעוד לא מכיר את השדה מתעלם ממנו.
        ...(kind === "ready" ? { pickup: nextPickup() } : {}),
        // לקישור: stage = "intake" כשזו הצעת הקבלה (036) ולא ממצאים. הבוט בוחר לפי זה
        // נוסח ("ההצעה שדיברנו עליה בקבלה", ולא "מה מצאנו"). בוט שלא מכיר את השדה מתעלם.
        ...extra,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const json = (await res.json().catch(() => null)) as { sent?: boolean; reason?: string } | null
    if (res.ok && json?.sent) return { status: "sent" }
    if (res.ok && json?.reason) return { status: "skipped", reason: json.reason }
    return { status: "failed", reason: json?.reason || `http_${res.status}` }
  } catch {
    return { status: "failed", reason: "unreachable" }
  }
}

async function notify(
  supabase: SupabaseClient,
  kind: Kind,
  rpc: string,
  args: Record<string, number>,
  extra: Record<string, string> = {},
) {
  // לא מחובר עדיין: לא תופסים כלום, כדי שכשיחברו, הבא בתור יישלח כרגיל.
  if (!process.env.GARAGE_NOTIFY_URL || !process.env.GARAGE_NOTIFY_TOKEN) return

  const { data, error } = await supabase.rpc(rpc, args)
  if (error) {
    console.error(`${rpc} failed:`, error.code, error.message)
    return
  }
  const claim = data as Claim | null
  if (!claim || !claim.send) return

  const to = toWaNumber(claim.phone)
  const outcome: Outcome = to ? await ask(kind, claim, to, extra) : { status: "skipped", reason: "bad_phone" }

  const { error: finishError } = await supabase.rpc("finish_notice", {
    p_id: claim.id,
    p_status: outcome.status,
    p_reason: outcome.reason ?? null,
  })
  if (finishError) console.error("finish_notice failed:", finishError.code, finishError.message)
}

/** אחרי שכרטיס עבר ל"מוכן". בטוח לקרוא פעמיים: המסד תופס פעם אחת. */
export function notifyReady(supabase: SupabaseClient, jobId: number) {
  return notify(supabase, "ready", "claim_ready_notice", { p_job_id: jobId })
}

/**
 * אחרי שדניאל שלח ממצא ללקוח: הקישור לאישור יוצא בוואטסאפ, במקום שדניאל
 * יעתיק אותו ביד. הודעה אחת לכל קישור; ממצא שנשלח שוב מקבל קישור חדש, ולכן
 * גם הודעה חדשה.
 */
export function notifyQuote(supabase: SupabaseClient, findingId: number) {
  return notify(supabase, "quote", "claim_quote_notice", { p_finding_id: findingId })
}

/**
 * 027: דניאל שולח כמה ממצאים יחד, והלקוח מקבל הודעה אחת עם קישור אחד לכולם.
 * הבוט מקבל טוקן, כמו קודם, ובונה ממנו את הקישור. הוא לא צריך לדעת שבקישור יש כמה ממצאים.
 */
export function notifyRequest(supabase: SupabaseClient, requestId: number, stage: "findings" | "intake" = "findings") {
  return notify(supabase, "quote", "claim_request_notice", { p_request_id: requestId }, stage === "intake" ? { stage } : {})
}

/** מה הצוות רואה בכרטיס. */
export function noticeLabel(
  n: { status: string; reason: string | null } | null | undefined,
  kind: Kind = "ready",
): string | null {
  if (!n) return null
  // 071: דניאל שלח בעצמו, מהוואטסאפ של המוסך, וסימן "שלחתי"
  if (n.status === "sent" && n.reason === "manual") return kind === "quote" ? "הקישור לאישור נשלח ידנית, מהוואטסאפ של המוסך" : "ההודעה שהרכב מוכן נשלחה ידנית"
  if (n.status === "sent") return kind === "quote" ? "הקישור לאישור נשלח ללקוח בוואטסאפ" : "נשלחה ללקוח הודעת וואטסאפ שהרכב מוכן"
  if (n.status === "pending") return kind === "quote" ? "שולחים ללקוח את הקישור לאישור…" : "שולחים ללקוח הודעה שהרכב מוכן…"
  const why: Record<string, string> = {
    no_consent: "הלקוח לא אישר וואטסאפ",
    no_phone: "אין טלפון בכרטיס",
    bad_phone: "הטלפון בכרטיס לא תקין",
    not_opted_in: "הלקוח לא כתב לנו בוואטסאפ ב-14 הימים האחרונים",
    history_failed: "לא הצלחנו לבדוק את השיחה עם הלקוח",
    not_wired: "השליחה עוד לא מחוברת",
    send_failed: "הוואטסאפ לא קיבל את ההודעה",
    unreachable: "הבוט לא ענה",
    no_site: "לבוט חסרה הכתובת של האתר",
  }
  const reason = (n.reason && why[n.reason]) || "תקלה בשליחה"
  if (kind === "quote") {
    return n.status === "failed" ? `הקישור לאישור לא יצא: ${reason}` : `הקישור לאישור לא נשלח ללקוח: ${reason}`
  }
  return n.status === "failed" ? `ההודעה שהרכב מוכן לא יצאה: ${reason}` : `לא נשלחה ללקוח הודעה שהרכב מוכן: ${reason}`
}

export type ReminderRun = { due: number; sent: number; skipped: number; failed: number }

/**
 * תזכורת ביום שלפני: כל התורים של מחר (שעון ישראל), עם הסכמה ועם טלפון.
 *
 * אין כאן משתמש מחובר — זה רץ ממשימה יומית, או מכפתור בלוח — ולכן זה עובר
 * בדלת הצרה של המסד, עם הטוקן המשותף. בטוח להריץ פעמיים: תזכורת שנשלחה לא
 * נתפסת שוב.
 */
export async function sendDueReminders(): Promise<ReminderRun> {
  const run: ReminderRun = { due: 0, sent: 0, skipped: 0, failed: 0 }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const secret = process.env.GARAGE_BOT_TOKEN
  if (!url || !key || !secret || !process.env.GARAGE_NOTIFY_URL || !process.env.GARAGE_NOTIFY_TOKEN) return run

  const rpc = (name: string, args: Record<string, unknown>) =>
    fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_secret: secret, ...args }),
      cache: "no-store",
    })

  const res = await rpc("claim_due_reminders", {})
  if (!res.ok) {
    console.error("claim_due_reminders failed:", res.status)
    return run
  }
  const claims = ((await res.json()) ?? []) as Claim[]
  run.due = claims.length

  for (const claim of claims) {
    const to = toWaNumber(claim.phone)
    const outcome: Outcome = to ? await ask("reminder", claim, to) : { status: "skipped", reason: "bad_phone" }
    run[outcome.status]++
    const done = await rpc("finish_reminder", { p_id: claim.id, p_status: outcome.status, p_reason: outcome.reason ?? null })
    if (!done.ok) console.error("finish_reminder failed:", done.status)
  }
  return run
}

/**
 * תזכורת ללקוח שלא ענה על קישור לאישור תוך 30 דקות (018). pg_cron במסד קורא
 * לאתר כל 5 דקות, והמסד תופס כל קישור פעם אחת בלבד, ורק בשעות העבודה.
 * הבוט מקבל את אותו סוג הודעה כמו הקישור המקורי: אותו קישור, שוב.
 */
export async function sendDueNudges(): Promise<ReminderRun> {
  const run: ReminderRun = { due: 0, sent: 0, skipped: 0, failed: 0 }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const secret = process.env.GARAGE_BOT_TOKEN
  if (!url || !key || !secret || !process.env.GARAGE_NOTIFY_URL || !process.env.GARAGE_NOTIFY_TOKEN) return run

  const rpc = (name: string, args: Record<string, unknown>) =>
    fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_secret: secret, ...args }),
      cache: "no-store",
    })

  const res = await rpc("claim_due_nudges", {})
  if (!res.ok) {
    console.error("claim_due_nudges failed:", res.status)
    return run
  }
  const claims = ((await res.json()) ?? []) as Claim[]
  run.due = claims.length

  for (const claim of claims) {
    const to = toWaNumber(claim.phone)
    const outcome: Outcome = to ? await ask("quote", claim, to) : { status: "skipped", reason: "bad_phone" }
    run[outcome.status]++
    const done = await rpc("finish_nudge", { p_id: claim.id, p_status: outcome.status, p_reason: outcome.reason ?? null })
    if (!done.ok) console.error("finish_nudge failed:", done.status)
  }
  return run
}
