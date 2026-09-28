import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { requireStaff } from "@/lib/staff/session"
import { reissueQuote, resendQuoteNotice, resendReadyNotice, setJobStatus } from "../../actions"
import { noticeLabel } from "@/lib/staff/notify"
import { DraftForm } from "@/components/staff/draft-form"
import { AddPhoto } from "@/components/staff/add-photo"
import type { PriceItem } from "@/components/staff/arrive-form"
import { INSPECTION_ITEMS, type InspectionState } from "@/lib/staff/inspection"
import { choiceAndPrice, money } from "@/lib/staff/quote"
import { RetryButton } from "@/components/staff/retry-button"
import { fmtStamp } from "@/lib/staff/format"
import { TopBar } from "@/components/staff/top-bar"

export const metadata: Metadata = { title: "כרטיס עבודה | מוסך לוי ובניו", robots: { index: false, follow: false } }

const findingStatus: Record<string, string> = {
  draft: "טיוטה, עוד לא נשלחה",
  sent: "נשלחה ללקוח, ממתינים לתשובה",
  approved: "הלקוח אישר",
  declined: "הלקוח דחה",
  cancelled: "בוטלה",
}

// האם הקישור לאישור יצא ללקוח בוואטסאפ. בלי שורה בכלל: השליחה עוד לא
// מחוברת, או שהממצא נשלח לפני שהיא חוברה — והקישור עדיין מועתק ביד.
function QuoteNoticeLine({
  notice,
  findingId,
  jobId,
  canSend,
}: {
  notice: { status: string; reason: string | null; sent_at: string | null } | undefined
  findingId: number
  jobId: number
  canSend: boolean
}) {
  const text = noticeLabel(notice, "quote")
  if (!notice || !text) return null
  return (
    <div className={`staff-note notice-${notice.status}`} role="status">
      {text}
      {notice.status === "sent" && notice.sent_at ? ` · ${fmtStamp(notice.sent_at)}` : ""}
      {notice.status === "failed" && canSend && (
        <form action={resendQuoteNotice} className="notice-retry">
          <input type="hidden" name="finding_id" value={findingId} />
          <input type="hidden" name="job_id" value={jobId} />
          <button className="btn quiet" type="submit">לשלוח שוב</button>
        </form>
      )}
    </div>
  )
}

const QUOTE_NOTE: Record<string, string> = {
  sent: "הצעת המחיר נשלחה ללקוח במייל.",
  noemail: "שליחת מייל עוד לא מחוברת. להדפיס את ההצעה ולתת ללקוח ביד.",
  failed: "המייל עם הצעת המחיר לא נשלח. אפשר לשלוח שוב, או להדפיס.",
}

export default async function JobCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ quote?: string }>
}) {
  const staff = await requireStaff()
  const { id } = await params
  const { quote } = await searchParams
  const jobId = Number(id)
  if (!Number.isFinite(jobId)) notFound()

  const supabase = await createClient()

  const { data: job } = await supabase
    .from("job_cards")
    .select("*")
    .eq("id", jobId)
    .maybeSingle()
  if (!job) notFound()

  const { data: findings } = await supabase
    .from("findings")
    .select("*, approvals(token, decision, decided_at, part_choice, price_chosen, message_text)")
    .eq("job_card_id", jobId)
    .order("created_at", { ascending: false })

  const [{ data: lines }, { data: versions }, { data: priceItems }, { data: inspection }] = await Promise.all([
    supabase.from("quote_items").select("title, part_choice, price_original, price_aftermarket, labor_hours").eq("job_card_id", jobId),
    supabase.from("quote_versions").select("version, reason, channel, status, error, sent_at, created_at").eq("job_card_id", jobId).order("version", { ascending: false }),
    supabase.from("price_list").select("*").eq("active", true).order("sort", { ascending: true }),
    supabase.from("inspections").select("items, completed_at").eq("job_card_id", jobId).maybeSingle(),
  ])
  const insItems = (inspection?.items as InspectionState) ?? {}
  // ממצא מבדיקת הכניסה יודע מאיזה פריט הוא בא, והפריט יודע איזו עבודה כנראה תידרש.
  const suggestFor = new Map<number, string>()
  for (const item of INSPECTION_ITEMS) {
    const fid = insItems[item.key]?.finding_id
    if (fid && item.suggest) suggestFor.set(fid, item.suggest)
  }

  const { data: media } = await supabase
    .from("media")
    .select("id, kind, storage_path, mime, finding_id, created_at")
    .eq("job_card_id", jobId)
    .order("created_at", { ascending: false })

  // מה יצא ללקוח בוואטסאפ, ואם לא, למה. "הרכב מוכן" אחד לכרטיס, והקישור
  // לאישור אחד לכל קישור (ref הוא הטוקן שלו). מסך תלוי לא מגיע לכאן.
  const { data: notices } = await supabase
    .from("customer_notices")
    .select("kind, ref, status, reason, sent_at")
    .eq("job_card_id", jobId)
  const notice = (notices ?? []).find((n) => n.kind === "ready") ?? null
  const noticeText = noticeLabel(notice)
  const quoteNotice = new Map((notices ?? []).filter((n) => n.kind === "quote").map((n) => [n.ref, n]))

  const photos = (media ?? []).filter((m) => m.kind === "photo")
  // הקלטה ששמורה ואין לה טיוטה: המודל נפל, ומה שנאמר עדיין כאן.
  const orphanAudio = (media ?? []).filter((m) => m.kind === "audio" && !m.finding_id)

  // הדלי פרטי, ולכן כל קובץ מקבל כתובת חתומה לשעה. אין כתובת קבועה שאפשר
  // להעביר הלאה, וזה בכוונה: אלה תמונות של רכב של לקוח.
  const signed = new Map<string, string>()
  const toSign = [...photos, ...orphanAudio].map((m) => m.storage_path)
  if (toSign.length) {
    const { data: urls } = await supabase.storage.from("job-media").createSignedUrls(toSign, 3600)
    for (const u of urls ?? []) if (u.signedUrl && u.path) signed.set(u.path, u.signedUrl)
  }

  const canSend = staff.role !== "mechanic"

  return (
    <main className="staff-wrap">
      <TopBar staff={staff} current="other" />

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
        <div className="job-actions">
          {job.status !== "ready" && job.status !== "delivered" && (
            <form action={setJobStatus}>
              <input type="hidden" name="job_id" value={job.id} />
              <input type="hidden" name="status" value="ready" />
              <button className="btn" type="submit">הרכב מוכן</button>
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
      </header>

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

      {quote && QUOTE_NOTE[quote] && (
        <p className={`staff-note ${quote === "sent" ? "notice-sent" : "notice-failed"}`} role="status">
          {QUOTE_NOTE[quote]}
        </p>
      )}

      <section className="staff-section" aria-labelledby="quote-title">
        <h2 id="quote-title">הצעת המחיר</h2>
        {(lines ?? []).length === 0 ? (
          <p className="staff-empty">לרכב הזה אין הצעה מהקבלה (נפתח לפני שהקבלה עברה לדלפק).</p>
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
                {job.customer_email ? "לשלוח את ההצעה המעודכנת במייל" : "אין מייל ללקוח"}
              </button>
            </form>
            <Link className="btn quiet" href={`/staff/job/${job.id}/quote`}>להדפסה</Link>
          </div>
        )}
      </section>

      {inspection && (
        <section className="staff-section" aria-labelledby="ins-title">
          <h2 id="ins-title">אבחון {inspection.completed_at ? `· הסתיימה ${fmtStamp(inspection.completed_at)}` : "· בתהליך"}</h2>
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

      <section className="staff-section" aria-labelledby="findings-title">
        <h2 id="findings-title">מה נמצא ברכב</h2>

        {(findings ?? []).length === 0 ? (
          <p className="staff-empty">
            עוד לא דווח כלום. המכונאי מקליט מ<Link href={`/staff/lift`}>דף הליפט</Link>, והדיווח יופיע כאן כטיוטה.
          </p>
        ) : (
          <ul className="job-findings">
            {(findings ?? []).map((f) => {
              const approval = Array.isArray(f.approvals) ? f.approvals[0] : f.approvals
              return (
                <li key={f.id} id={`f-${f.id}`} className={`job-finding status-${f.status}${f.urgency ? ` urgency-${f.urgency}` : ""}`}>
                  <div className="job-finding-head">
                    <b>
                      {f.urgency && <span className={`light-dot ${f.urgency}`} aria-hidden />}
                      {f.title ? `${f.title} · ` : ""}
                      {findingStatus[f.status] ?? f.status}
                      {f.safety ? " · בטיחות" : ""}
                    </b>
                    <span className="staff-meta">{fmtStamp(f.created_at)}{f.model ? ` · ${f.model}` : ""}</span>
                    {f.red_list && <span className="job-red">רשימה אדומה: לעצור ולקרוא לאבי</span>}
                  </div>

                  {f.transcript && (
                    <details className="job-transcript">
                      <summary>מה נאמר בהקלטה</summary>
                      <p>{f.transcript}</p>
                    </details>
                  )}

                  {f.status === "draft" && (() => {
                    // התמונות של הממצא הזה בלבד: הן שיוצאות ללקוח עם ההצעה.
                    const own = photos.filter((m) => m.finding_id === f.id)
                    return (
                      <>
                        {own.length > 0 && (
                          <ul className="finding-photos">
                            {own.map((m) => {
                              const url = signed.get(m.storage_path)
                              return url ? (
                                <li key={m.id}>
                                  {/* eslint-disable-next-line @next/next/no-img-element -- כתובת חתומה לשעה */}
                                  <img src={url} alt={`תמונה של הממצא, ${fmtStamp(m.created_at)}`} loading="lazy" />
                                </li>
                              ) : null
                            })}
                          </ul>
                        )}
                        {canSend && <AddPhoto findingId={f.id} missing={own.length === 0 && (f.urgency === "red" || Boolean(f.safety))} />}
                      </>
                    )
                  })()}

                  {f.status === "draft" ? (
                    canSend ? (
                      <DraftForm jobId={job.id} draft={f} items={(priceItems ?? []) as PriceItem[]} suggest={suggestFor.get(f.id)} maxDiscount={staff.role === "owner" ? 30 : 10} />
                    ) : (
                      <p className="job-note">
                        הטיוטה מוכנה. <b>מנהל עבודה או הבעלים שולחים ללקוח</b>, לא מכונאי.
                      </p>
                    )
                  ) : (
                    <>
                      <blockquote className="job-sent">{approval?.message_text ?? f.customer_text}</blockquote>
                      {approval?.decision ? (
                        <p className={`job-decision ${approval.decision}`}>
                          {approval.decision === "approved"
                            ? `הלקוח אישר: ${choiceAndPrice(approval.part_choice, f.price_aftermarket, approval.price_chosen)}`
                            : "הלקוח דחה את התיקון"}
                          {" · "}
                          {fmtStamp(approval.decided_at)}
                        </p>
                      ) : (
                        approval?.token && (
                          <>
                            <p className="job-note">
                              ממתינים לתשובה.{" "}
                              <a href={`/approve/${approval.token}`} target="_blank" rel="noreferrer">
                                הקישור שנשלח ללקוח
                              </a>
                            </p>
                            <QuoteNoticeLine
                              notice={quoteNotice.get(approval.token)}
                              findingId={f.id}
                              jobId={job.id}
                              canSend={canSend}
                            />
                          </>
                        )
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {orphanAudio.length > 0 && (
        <section className="staff-section" aria-labelledby="orphan-title">
          <h2 id="orphan-title">הקלטות שלא תומללו</h2>
          <p className="staff-meta">
            המכונאי דיווח, והמודל נפל. ההקלטה עצמה שמורה — אפשר להאזין לה, או לנסות לתמלל שוב.
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

      {photos.length > 0 && (
        <section className="staff-section" aria-labelledby="photos-title">
          <h2 id="photos-title">תמונות</h2>
          <p className="staff-meta">מה שהמכונאי צילם. הקישורים פגים אחרי שעה, ולכן אי אפשר להעביר אותם הלאה.</p>
          <ul className="job-photos">
            {photos.map((m) => {
              const url = signed.get(m.storage_path)
              return (
                <li key={m.id}>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`תמונה מהכרטיס, ${fmtStamp(m.created_at)}`} loading="lazy" />
                    </a>
                  ) : (
                    <span className="staff-meta">התמונה לא נטענה</span>
                  )}
                  <span className="staff-meta">{fmtStamp(m.created_at)}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </main>
  )
}
