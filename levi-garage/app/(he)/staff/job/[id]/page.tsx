import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { requireStaff } from "@/lib/staff/session"
import { markIntakeSigned, reissueQuote, resendIntakeRequest, resendReadyNotice, resendRequestNotice, setJobStatus } from "../../actions"
import { noticeLabel } from "@/lib/staff/notify"
import { QuoteBuilder, type BuilderDraft } from "@/components/staff/quote-builder"
import { AddPhoto } from "@/components/staff/add-photo"
import type { PriceItem } from "@/components/staff/arrive-form"
import { INSPECTION_ITEMS, type InspectionState } from "@/lib/staff/inspection"
import { choiceAndPrice } from "@/lib/staff/quote"
import { RetryButton } from "@/components/staff/retry-button"
import { fmtStamp } from "@/lib/staff/format"
import { TopBar } from "@/components/staff/top-bar"
import { AutoRefresh } from "@/components/staff/auto-refresh"

export const metadata: Metadata = { title: "כרטיס עבודה | מוסך לוי ובניו", robots: { index: false, follow: false } }

// כרטיס העבודה של דניאל (נבנה מחדש ב-30.9, אחרי הסבב של רועי: "יש שם בלאגן").
// מלמעלה למטה, לפי מה שדניאל צריך לעשות:
//   1. לשלוח ללקוח: הטיוטות, ושליחה אחת לכולן.
//   2. נשלח ללקוח: לפי הודעה (בקשה), לא לפי ממצא. מה אושר, מה נדחה, מה ממתין.
//   3. הצעת המחיר מהקבלה, והגרסאות שיצאו במייל.
//   4. האבחון, ומה שבוטל.

const INTAKE_NOTE: Record<string, string> = {
  sent: "הקישור לאישור ההצעה נשלח שוב ללקוח: במייל אם יש, ובוואטסאפ (אם עברו 10 דקות מהשליחה הקודמת).",
  consent: "הלקוח לא הסכים לעדכונים בוואטסאפ ובמייל: להדפיס את ההצעה ולהחתים אותו.",
  failed: "השליחה נכשלה. לנסות שוב, או להדפיס ולהחתים.",
}

const QUOTE_NOTE: Record<string, string> = {
  sent: "הצעת המחיר נשלחה ללקוח במייל.",
  noemail: "שליחת מייל עוד לא מחוברת. להדפיס את ההצעה ולתת ללקוח ביד.",
  failed: "המייל עם הצעת המחיר לא נשלח. אפשר לשלוח שוב, או להדפיס.",
}

type Approval = {
  token: string
  request_id: number | null
  decision: string | null
  decided_at: string | null
  part_choice: string | null
  price_chosen: number | null
  message_text: string | null
  sent_at: string | null
}

export default async function JobCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ quote?: string; intake?: string }>
}) {
  const staff = await requireStaff()
  const { id } = await params
  const { quote, intake } = await searchParams
  const jobId = Number(id)
  if (!Number.isFinite(jobId)) notFound()

  const supabase = await createClient()

  const { data: job } = await supabase.from("job_cards").select("*").eq("id", jobId).maybeSingle()
  if (!job) notFound()

  const [
    { data: findings },
    { data: lines },
    { data: versions },
    { data: priceItems },
    { data: inspection },
    { data: media },
    { data: notices },
    { data: requests },
    { data: doneCall },
  ] = await Promise.all([
    supabase
      .from("findings")
      .select("*, reporter:safety_reported_by(full_name), approvals(token, request_id, decision, decided_at, part_choice, price_chosen, message_text, sent_at)")
      .eq("job_card_id", jobId)
      .order("created_at", { ascending: true }),
    supabase.from("quote_items").select("title, part_choice, price_original, price_aftermarket, labor_hours").eq("job_card_id", jobId),
    supabase.from("quote_versions").select("version, reason, channel, status, error, sent_at, created_at").eq("job_card_id", jobId).order("version", { ascending: false }),
    supabase.from("price_list").select("*").eq("active", true).order("sort", { ascending: true }),
    supabase.from("inspections").select("items, completed_at").eq("job_card_id", jobId).maybeSingle(),
    supabase.from("media").select("id, kind, storage_path, mime, finding_id, created_at").eq("job_card_id", jobId).order("created_at", { ascending: true }),
    supabase.from("customer_notices").select("kind, ref, status, reason, sent_at").eq("job_card_id", jobId),
    supabase.from("quote_requests").select("id, token, sent_at, decided_at, expires_at, nudged_at").eq("job_card_id", jobId).order("sent_at", { ascending: false }),
    supabase.from("help_calls").select("id").eq("job_card_id", jobId).eq("kind", "done").is("resolved_at", null).limit(1),
  ])

  const all = findings ?? []
  const approvalOf = (f: (typeof all)[number]) => (Array.isArray(f.approvals) ? f.approvals[0] : f.approvals) as Approval | null
  const drafts = all.filter((f) => f.status === "draft")
  const sent = all.filter((f) => f.status === "sent" || f.status === "approved" || f.status === "declined")
  const cancelled = all.filter((f) => f.status === "cancelled")

  const insItems = (inspection?.items as InspectionState) ?? {}
  // ממצא מבדיקת הכניסה יודע מאיזה פריט הוא בא, והפריט יודע איזו עבודה כנראה תידרש.
  const suggestFor: Record<number, string> = {}
  for (const item of INSPECTION_ITEMS) {
    const fid = insItems[item.key]?.finding_id
    if (fid && item.suggest) suggestFor[fid] = item.suggest
  }

  const notice = (notices ?? []).find((n) => n.kind === "ready") ?? null
  const noticeText = noticeLabel(notice)
  const quoteNotice = new Map((notices ?? []).filter((n) => n.kind === "quote").map((n) => [n.ref, n]))

  const photos = (media ?? []).filter((m) => m.kind === "photo")
  // הקלטה ששמורה ואין לה טיוטה: המודל נפל, ומה שנאמר עדיין כאן.
  const orphanAudio = (media ?? []).filter((m) => m.kind === "audio" && !m.finding_id)
  // הדלי פרטי, ולכן כל קובץ מקבל כתובת חתומה לשעה. אלה תמונות של רכב של לקוח.
  const signed = new Map<string, string>()
  const toSign = [...photos, ...orphanAudio].map((m) => m.storage_path)
  if (toSign.length) {
    const { data: urls } = await supabase.storage.from("job-media").createSignedUrls(toSign, 3600)
    for (const u of urls ?? []) if (u.signedUrl && u.path) signed.set(u.path, u.signedUrl)
  }
  const photoList = (findingId: number) => {
    const own = photos.filter((m) => m.finding_id === findingId)
    return own.length ? (
      <ul className="finding-photos">
        {own.map((m) => {
          const url = signed.get(m.storage_path)
          return url ? (
            <li key={m.id}>
              <a href={url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- כתובת חתומה לשעה */}
                <img src={url} alt={`תמונה של הממצא, ${fmtStamp(m.created_at)}`} loading="lazy" />
              </a>
            </li>
          ) : null
        })}
      </ul>
    ) : null
  }

  const canSend = staff.role !== "mechanic"
  const pending = drafts.length + all.filter((f) => f.status === "sent").length
  // "הרכב מוכן" רק כשבאמת אפשר: אחרי אבחון, ובלי ממצאים שמחכים (רועי, 30.9: הכפתור הופיע
  // על רכב שעוד לא עלה לליפט, ולחיצה בטעות שולחת ללקוח "הרכב מוכן").
  const canReady = Boolean(job.inspected_at) && pending === 0 && job.status !== "ready" && job.status !== "delivered"
  const mechanicDone = (doneCall ?? []).length > 0

  // מה נשלח, לפי הודעה. ממצא שנשלח לפני 027 (בלי בקשה) מוצג כהודעה משלו.
  type Group = { key: string; requestId: number | null; token: string; sentAt: string | null; decidedAt: string | null; items: typeof sent }
  const groups: Group[] = []
  for (const r of requests ?? []) {
    const items = sent.filter((f) => approvalOf(f)?.request_id === r.id)
    if (items.length) groups.push({ key: `r${r.id}`, requestId: r.id, token: r.token, sentAt: r.sent_at, decidedAt: r.decided_at, items })
  }
  for (const f of sent.filter((x) => !approvalOf(x)?.request_id)) {
    const a = approvalOf(f)
    groups.push({ key: `f${f.id}`, requestId: null, token: a?.token ?? "", sentAt: a?.sent_at ?? f.sent_at, decidedAt: a?.decided_at ?? null, items: [f] })
  }

  return (
    <main className="staff-wrap job-page">
      <TopBar staff={staff} current="other" />
      <AutoRefresh seconds={30} live />

      <header className="staff-top">
        <div>
          <Link className="staff-back" href="/staff">חזרה ללוח</Link>
          <h1>
            <span className="plate-chip num" dir="ltr">{job.plate}</span>{" "}
            {[job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ")}
            {job.vehicle_year ? `, ${job.vehicle_year}` : ""}
          </h1>
          <p>
            {job.customer_name || "ללא שם"}
            {job.lift ? ` · ליפט ${job.lift}` : ""}
            {job.engine_code ? ` · מנוע ${job.engine_code}` : ""}
            {job.whatsapp_consent ? " · אישר קבלת וואטסאפ" : " · בלי אישור וואטסאפ"}
          </p>
        </div>
        {canSend && (
          <div className="job-actions">
            {canReady && (
              <form action={setJobStatus}>
                <input type="hidden" name="job_id" value={job.id} />
                <input type="hidden" name="status" value="ready" />
                <button className={mechanicDone ? "btn" : "btn quiet"} type="submit">הרכב מוכן</button>
              </form>
            )}
            {job.status === "ready" && (
              <form action={setJobStatus}>
                <input type="hidden" name="job_id" value={job.id} />
                <input type="hidden" name="status" value="delivered" />
                <button className="btn" type="submit">נמסר ללקוח</button>
              </form>
            )}
          </div>
        )}
      </header>

      {/* 036: ההצעה של הקבלה. עד שהלקוח מאשר, הרכב לא עולה לליפט. */}
      {!job.work_approved_at && job.status !== "delivered" && (job.status as string) !== "cancelled" && (
        <div className="staff-note notice-failed intake-note" role="status">
          <b>ממתין לאישור הלקוח על הצעת הקבלה.</b> הרכב בחניה ולא עולה לליפט עד שהלקוח מאשר בקישור, או חותם על העותק המודפס.
          {canSend && (
            <div className="intake-note-actions">
              <form action={markIntakeSigned}>
                <input type="hidden" name="job_id" value={job.id} />
                <button className="btn" type="submit">חתם על העותק המודפס</button>
              </form>
              <form action={resendIntakeRequest}>
                <input type="hidden" name="job_id" value={job.id} />
                <button className="btn quiet" type="submit">לשלוח שוב את הקישור</button>
              </form>
              <Link className="btn quiet" href={`/staff/job/${job.id}/quote?print=1`}>להדפיס לחתימה</Link>
            </div>
          )}
        </div>
      )}
      {job.work_approved_at && (
        <p className="staff-meta intake-approved">
          ההצעה של הקבלה אושרה{" "}
          {job.work_approved_via === "link" ? "על ידי הלקוח בקישור" : job.work_approved_via === "print" ? "בחתימה על עותק מודפס" : "בדלפק"} ·{" "}
          {fmtStamp(job.work_approved_at)}
        </p>
      )}
      {intake && INTAKE_NOTE[intake] && (
        <p className={`staff-note ${intake === "sent" ? "notice-sent" : "notice-failed"}`} role="status">
          {INTAKE_NOTE[intake]}
        </p>
      )}

      {(mechanicDone || job.work_done_at) && job.status !== "ready" && job.status !== "delivered" && (job.status as string) !== "cancelled" && (
        <p className="staff-note notice-sent" role="status">
          המכונאי סיים את העבודה.{canReady ? " לבדוק, ואז \"הרכב מוכן\": הלקוח מקבל הודעה בוואטסאפ." : ""}
        </p>
      )}
      {!canReady && job.status !== "ready" && job.status !== "delivered" && canSend && (
        <p className="staff-meta job-ready-why">
          {!job.inspected_at
            ? "\"הרכב מוכן\" יופיע אחרי האבחון."
            : `"הרכב מוכן" יופיע כשלא יישארו ממצאים שמחכים (${pending === 1 ? "ממצא אחד" : `${pending} ממצאים`}).`}
        </p>
      )}

      {noticeText && (
        <div className={`staff-note notice-${notice?.status}`} role="status">
          {noticeText}
          {notice?.status === "sent" && notice.sent_at ? ` · ${fmtStamp(notice.sent_at)}` : ""}
          {notice?.status === "failed" && job.status === "ready" && (
            <form action={resendReadyNotice} className="notice-retry">
              <input type="hidden" name="job_id" value={job.id} />
              <button className="btn quiet" type="submit">לשלוח שוב</button>
            </form>
          )}
        </div>
      )}

      {/* מה קרה אחרי "מוכן": מתי נמסר, ומתי ועל ידי מי דווח ליקוי בטיחותי שהלקוח דחה.
          בסבב 2.10 "דווח" נשמר במסד ולא הופיע בשום מקום (ממצא 19). */}
      {job.status === "delivered" && job.delivered_at && (
        <p className="staff-note notice-sent" role="status">נמסר ללקוח · {fmtStamp(job.delivered_at)}</p>
      )}
      {all
        .filter((f) => f.safety_reported_at)
        .map((f) => (
          <p key={`rep-${f.id}`} className="staff-note notice-sent" role="status">
            דווח לרשות הרישוי על ליקוי בטיחותי שלא תוקן: {f.title} · {fmtStamp(f.safety_reported_at)}
            {(Array.isArray(f.reporter) ? f.reporter[0] : f.reporter)?.full_name
              ? ` · ${(Array.isArray(f.reporter) ? f.reporter[0] : f.reporter).full_name}`
              : ""}
          </p>
        ))}

      {quote && QUOTE_NOTE[quote] && (
        <p className={`staff-note ${quote === "sent" ? "notice-sent" : "notice-failed"}`} role="status">
          {QUOTE_NOTE[quote]}
        </p>
      )}

      {drafts.length > 0 && (
        <section className="staff-section" aria-labelledby="send-title">
          <h2 id="send-title">
            לשלוח ללקוח <span className="job-count">{drafts.length}</span>
          </h2>
          {canSend ? (
            <>
              <p className="staff-meta">לכל ממצא: עבודה מהמחירון, ולבדוק את הנוסח. כשהכול מוכן, שליחה אחת למטה.</p>
              <QuoteBuilder
                jobId={job.id}
                drafts={drafts.map(
                  (f): BuilderDraft => ({
                    id: f.id,
                    title: f.title,
                    customer_text: f.customer_text,
                    price_list_id: f.price_list_id,
                    price_original: f.price_original,
                    price_aftermarket: f.price_aftermarket,
                    list_price_original: f.list_price_original,
                    list_price_aftermarket: f.list_price_aftermarket,
                    discount_pct: f.discount_pct,
                    discount_reason: f.discount_reason,
                    labor_hours: f.labor_hours,
                    warranty_original: f.warranty_original,
                    warranty_aftermarket: f.warranty_aftermarket,
                    part_diff: f.part_diff,
                    single_reason: f.single_reason,
                    eta: f.eta,
                    safety: Boolean(f.safety),
                    urgency: f.urgency,
                    red_list: f.red_list,
                    transcript: f.transcript,
                    summary: f.summary,
                    created_at: f.created_at,
                    stamp: `${fmtStamp(f.created_at)}${f.source === "pricelist" ? " · מהמחירון, מהעמדה" : ""}`,
                  }),
                )}
                items={(priceItems ?? []) as PriceItem[]}
                suggestFor={suggestFor}
                maxDiscount={staff.role === "owner" ? 30 : 10}
                extras={Object.fromEntries(
                  drafts.map((f) => [
                    f.id,
                    <div key={f.id} className="qb-photos">
                      {photoList(f.id)}
                      <AddPhoto findingId={f.id} missing={!photos.some((m) => m.finding_id === f.id) && (f.urgency === "red" || Boolean(f.safety))} />
                    </div>,
                  ]),
                )}
              />
            </>
          ) : (
            <ul className="job-sent-list">
              {drafts.map((f) => (
                <li key={f.id}>📝 {f.title || f.summary}: אצל דניאל, עוד לא נשלח ללקוח.</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {groups.length > 0 && (
        <section className="staff-section" aria-labelledby="sent-title">
          <h2 id="sent-title">נשלח ללקוח</h2>
          <ul className="job-groups">
            {groups.map((g) => {
              const n = quoteNotice.get(g.token)
              const open = g.items.some((f) => f.status === "sent")
              return (
                <li key={g.key} className={`job-group ${open ? "open" : "done"}`}>
                  <div className="job-group-head">
                    <b>
                      {open ? "⏳ ממתינים לתשובה" : "✓ הלקוח ענה"} · {g.items.length === 1 ? "ממצא אחד" : `${g.items.length} ממצאים`}
                    </b>
                    <span className="staff-meta">
                      נשלח {fmtStamp(g.sentAt)}
                      {g.decidedAt ? ` · ענה ${fmtStamp(g.decidedAt)}` : ""}
                    </span>
                  </div>
                  <ul className="job-group-items">
                    {g.items.map((f) => {
                      const a = approvalOf(f)
                      return (
                        <li key={f.id} className={`status-${f.status}`}>
                          <span className={`light-dot ${f.urgency === "red" ? "red" : "yellow"}`} aria-hidden /> <b>{f.title || f.summary}</b>
                          {f.safety ? " · בטיחות" : ""}
                          {" · "}
                          {f.status === "approved"
                            ? `✓ אישר: ${choiceAndPrice(a?.part_choice, f.price_aftermarket, a?.price_chosen)}`
                            : f.status === "declined"
                              ? "✗ לא אישר"
                              : "ממתין"}
                        </li>
                      )
                    })}
                  </ul>
                  {open && g.token && (
                    <p className="job-note">
                      <a href={`/approve/${g.token}`} target="_blank" rel="noreferrer">הקישור שנשלח ללקוח</a>
                      {n && noticeLabel(n, "quote") ? ` · ${noticeLabel(n, "quote")}` : ""}
                      {n?.status === "sent" && n.sent_at ? ` · ${fmtStamp(n.sent_at)}` : ""}
                    </p>
                  )}
                  {open && canSend && g.requestId && n?.status === "failed" && (
                    <form action={resendRequestNotice} className="notice-retry">
                      <input type="hidden" name="request_id" value={g.requestId} />
                      <input type="hidden" name="job_id" value={job.id} />
                      <button className="btn quiet" type="submit">לשלוח שוב בוואטסאפ</button>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="staff-section" aria-labelledby="quote-title">
        <h2 id="quote-title">הצעת המחיר מהקבלה</h2>
        {(lines ?? []).length === 0 ? (
          <p className="staff-empty">לרכב הזה אין הצעה מהקבלה.</p>
        ) : (
          <ul className="quote-lines">
            {(lines ?? []).map((l, i) => (
              <li key={i}>
                <b>{l.title}</b> ·{" "}
                {choiceAndPrice(l.part_choice, l.price_aftermarket, l.part_choice === "aftermarket" ? l.price_aftermarket : l.price_original)} ·{" "}
                {Number(l.labor_hours)} שע׳
              </li>
            ))}
          </ul>
        )}
        {(versions ?? []).length > 0 && (
          <ul className="quote-versions">
            {(versions ?? []).map((v) => (
              <li key={v.version}>
                גרסה {v.version} · {v.reason === "intake" ? "בקבלה" : "עדכון"} · {v.channel === "email" ? "מייל" : "מודפסת"} ·{" "}
                {v.status === "sent" ? `יצאה ${fmtStamp(v.sent_at)}` : v.status === "failed" ? "לא יצאה" : "ממתינה"}
              </li>
            ))}
          </ul>
        )}
        {canSend && (lines ?? []).length > 0 && (
          <div className="quote-actions">
            <form action={reissueQuote}>
              <input type="hidden" name="job_id" value={job.id} />
              <input type="hidden" name="channel" value="email" />
              <button className="btn quiet" type="submit" disabled={!job.customer_email}>
                {job.customer_email ? "לשלוח שוב במייל (מה שאושר עד עכשיו)" : "אין מייל ללקוח"}
              </button>
            </form>
            <Link className="btn quiet" href={`/staff/job/${job.id}/quote`}>להדפסה</Link>
          </div>
        )}
        <p className="staff-meta">אחרי שהלקוח עונה בקישור, ההצעה המעודכנת נשלחת אליו במייל לבד.</p>
      </section>

      {inspection && (
        <section className="staff-section" aria-labelledby="ins-title">
          <h2 id="ins-title">אבחון {inspection.completed_at ? `· הסתיים ${fmtStamp(inspection.completed_at)}` : "· בתהליך"}</h2>
          <ul className="inspect-summary">
            {INSPECTION_ITEMS.map((item) => {
              const light = insItems[item.key]?.light
              return (
                <li key={item.key} className={light ?? "none"}>
                  <span className={`light-dot ${light ?? "none"}`} aria-hidden /> {item.label}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {orphanAudio.length > 0 && (
        <section className="staff-section" aria-labelledby="orphan-title">
          <h2 id="orphan-title">הקלטות שלא תומללו</h2>
          <p className="staff-meta">
            המכונאי דיווח, והמודל נפל. ההקלטה עצמה שמורה: אפשר להאזין לה, או לנסות לתמלל שוב.
            <b> אף אחד לא צריך לדבר שוב.</b>
          </p>
          <ul className="job-orphans">
            {orphanAudio.map((m) => (
              <li key={m.id}>
                <span className="staff-meta">{fmtStamp(m.created_at)}</span>
                {signed.get(m.storage_path) && (
                  <audio controls preload="none" src={signed.get(m.storage_path)}>
                    הדפדפן לא יודע לנגן את ההקלטה.
                  </audio>
                )}
                <RetryButton mediaId={m.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {cancelled.length > 0 && (
        <details className="staff-section job-cancelled">
          <summary>בוטלו ({cancelled.length})</summary>
          <ul>
            {cancelled.map((f) => (
              <li key={f.id}>
                {f.title || f.summary} · {fmtStamp(f.created_at)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  )
}
