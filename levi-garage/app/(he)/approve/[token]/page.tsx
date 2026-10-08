import type { Metadata } from "next"

import { partLabel } from "@/lib/staff/quote"
import { createClient } from "@/lib/supabase/server"
import { PlateLogo } from "@/components/brand/plate-logo"
import { ApproveForm } from "@/components/staff/approve-form"
import { RequestForm, type RequestItem } from "@/components/staff/request-form"
import { IntakeForm } from "@/components/staff/intake-form"
import { choiceAndPrice } from "@/lib/staff/quote"
import { fmtStamp } from "@/lib/staff/format"

export const metadata: Metadata = {
  title: "אישור תיקון | מוסך לוי ובניו",
  robots: { index: false, follow: false },
}

// דף האישור של הלקוח. אין כאן התחברות ואין חשבון: הקישור עצמו הוא המפתח.
// הדף רואה רק את מה שנשלח לאותו קישור, ולא את שאר הלקוחות (RPC approval_view).
//
// מה החוק דורש שהלקוח יראה לפני שהוא מאשר (ס' 131–132): יותר מסוג חלק אחד
// והסבר ההבדל, שעות העבודה הצפויות, והאחריות לכל סוג. ומהמחקר: 64% מהלקוחות
// רוצים תמונה עם הממצא — וכאן היא, מה שהמכונאי צילם.

type View = {
  message_text: string
  title: string | null
  price_original: number | null
  price_aftermarket: number | null
  labor_hours: number | null
  warranty_original: string | null
  warranty_aftermarket: string | null
  part_diff: string | null
  single_reason: string | null
  safety: boolean
  eta: string | null
  photo_paths: string[] | null
  decision: string | null
  decided_at: string | null
  part_choice: string | null
  expired: boolean
  plate_last3: string | null
  vehicle: string | null
  list_price_original: number | null
  list_price_aftermarket: number | null
  discount_pct: number | null
}

// 049: הדלי פרטי. כתובת חתומה, והמסד נותן אותה רק כל עוד האישור בתוקף, ולכן אחרי שהקישור
// פג גם התמונות לא נפתחות (כמו שכתוב במדיניות הפרטיות). התוקף של הכתובת הוא שעה, או מה שנשאר
// לקישור אם זה פחות (055, ביקורת חוזרת, 8.10, ממצא 5): בלי זה תמונה נשארה פתוחה עד שעה אחרי.
type Supa = Awaited<ReturnType<typeof createClient>>
async function signPhotos(supabase: Supa, token: string, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  // תקלה בבדיקה: לא חותמים בכלל, במקום לחתום לשעה בלי לדעת כמה נשאר (ביקורת שלישית, 8.10, ממצא 4).
  // null בלי תקלה: לקישור אין מועד פקיעה, ונשארים עם שעה.
  const { data: left, error } = await supabase.rpc("link_seconds_left", { p_token: token })
  if (error) return {}
  const ttl = typeof left === "number" ? Math.min(60 * 60, left) : 60 * 60
  if (ttl < 1) return {}
  const { data } = await supabase.storage.from("shared-quotes").createSignedUrls(paths, ttl)
  const urls: Record<string, string> = {}
  for (const d of data ?? []) if (d.path && d.signedUrl && !d.error) urls[d.path] = d.signedUrl
  return urls
}

type RequestRow = Omit<RequestItem, "photos"> & {
  photo_paths: string[] | null
  decision: string | null
  decided_at: string | null
  part_choice: string | null
  price_chosen: number | null
  expired: boolean
  plate_last3: string | null
  vehicle: string | null
}

/**
 * 027: קישור אחד, כמה ממצאים. הלקוח רואה את כולם בדף אחד, ועונה על כולם בשליחה אחת
 * (רועי, 30.9: "לא שולחים הודעה 5 פעמים"). אחרי התשובה הדף הופך לאישור בכתב.
 */
type AgreedLine = { title: string; price: number | null }

// מה שאושר קודם, ועוד מה שאושר עכשיו בקישור הזה.
const agreedTotal = (agreed: AgreedLine[], rows: RequestRow[]) =>
  agreed.reduce((sum, l) => sum + Number(l.price ?? 0), 0) +
  rows.reduce((sum, r) => sum + (r.decision === "approved" ? Number(r.price_chosen ?? 0) : 0), 0)

function RequestPage({ token, rows, agreed, photoUrls }: { token: string; rows: RequestRow[]; agreed: AgreedLine[]; photoUrls: Record<string, string> }) {
  const first = rows[0]
  const open = rows.filter((r) => !r.decision)
  const decided = open.length === 0
  return (
    <main className="approve">
      <div className="approve-box">
        <PlateLogo className="approve-logo" height={38} />
        <h1>
          {first.vehicle || "הרכב שלך"}
          {first.plate_last3 ? (
            <>
              {" "}
              <span className="approve-plate num" dir="ltr">···{first.plate_last3}</span>
            </>
          ) : null}
        </h1>

        {decided ? (
          <div className="approve-done approved">
            <b>קיבלנו את התשובה שלך.</b>
            <ul className="req-summary">
              {rows.map((r) => (
                <li key={r.finding_id}>
                  {r.title}:{" "}
                  {r.decision === "approved" ? `✓ ${choiceAndPrice(r.part_choice, r.price_aftermarket, r.price_chosen)}` : "✗ לא לתקן"}
                </li>
              ))}
            </ul>
            {/* 4.10 (רועי): אחרי האישור, התמונה המלאה. מה אושר קודם (הקבלה וממצאים
                אחרים), ומה כל זה יחד. אותו סכום כמו בהצעה המעודכנת במייל. */}
            {agreed.length > 0 && (
              <div className="req-agreed">
                <p className="req-agreed-title">ואושר קודם:</p>
                <ul>
                  {agreed.map((l, i) => (
                    <li key={i}>
                      {l.title} · <span className="num">{shekel(Number(l.price))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="req-total">
              סה&quot;כ לתשלום לפי מה שאישרת: <b className="num">{shekel(agreedTotal(agreed, rows))}</b> (כולל מע&quot;מ)
            </p>
            <p className="approve-stamp">
              נרשם אצלנו בכתב, {fmtStamp(rows.find((r) => r.decided_at)?.decided_at ?? null)}. אם השארת לנו מייל, הצעת המחיר המעודכנת נשלחת אליך לשם.
            </p>
          </div>
        ) : first.expired ? (
          <p className="approve-note">הקישור פג. אפשר להתקשר אלינו ונסדר את זה בטלפון.</p>
        ) : (
          <>
            <p className="approve-message">
              {rows.length === 1 ? "במהלך העבודה על הרכב מצאנו משהו שדורש את האישור שלך." : `במהלך העבודה על הרכב מצאנו ${rows.length} דברים. לכל אחד אפשר לאשר או לא, בנפרד.`}
            </p>
            <RequestForm
              token={token}
              agreed={agreed}
              items={open.map((r) => ({
                finding_id: r.finding_id,
                title: r.title,
                message_text: r.message_text,
                price_original: r.price_original,
                price_aftermarket: r.price_aftermarket,
                warranty_original: r.warranty_original,
                warranty_aftermarket: r.warranty_aftermarket,
                labor_hours: r.labor_hours,
                part_diff: r.part_diff,
                single_reason: r.single_reason,
                safety: r.safety,
                eta: r.eta,
                photos: (r.photo_paths ?? []).map((p) => photoUrls[p]).filter(Boolean),
                discount_pct: r.discount_pct,
                list_price_original: r.list_price_original,
                list_price_aftermarket: r.list_price_aftermarket,
              }))}
            />
          </>
        )}

        <p className="approve-small">
          המחירים כוללים חלקים, עבודה ומע&quot;מ. בלי האישור שלך לא נוגעים ברכב. אם משהו לא ברור, אנחנו כאן: 055-3048489.
        </p>
      </div>
    </main>
  )
}

type IntakeLine = {
  title: string
  labor_hours: number | null
  part_choice: string | null
  price_original: number | null
  price_aftermarket: number | null
  warranty: string | null
  part_diff: string | null
  single_reason: string | null
  price: number | null
}
type Intake = {
  status: "open" | "approved" | "declined" | "expired" | "signed"
  decided_at: string | null
  plate_last3: string | null
  vehicle: string | null
  customer: string | null
  /** 039: רכב שהגיע בלי תור. הלקוח לא עבר בטופס של Cal.com, ולכן מאשר כאן את התקנון. */
  needs_terms?: boolean
  lines: IntakeLine[]
}

// 3.10: בדיקת הכניסה לא עולה כסף, ואף אחד לא ידע את זה. ללקוח זה שירות.
const FREE_INSPECTION = "בנוסף, בלי תשלום: בדיקת בטיחות של 9 נקודות, כמו לכל רכב שמגיע אלינו. מה שיימצא בה נשלח אליך לאישור בנפרד."

const shekel = (n: number | null) => (n === null ? "—" : `${Number(n).toLocaleString("he-IL")} ש"ח`)

/**
 * 036: ההצעה של הקבלה. הלקוח מאשר אותה כולה, מהטלפון, כבר מול הדלפק או אחר כך.
 * עד שהוא מאשר הרכב בחניה ולא עולה לליפט. אחרי ההכרעה הדף הופך לאישור בכתב.
 */
function IntakePage({ token, view }: { token: string; view: Intake }) {
  const total = view.lines.reduce((sum, l) => sum + Number(l.price ?? 0), 0)
  const hoursTotal = view.lines.reduce((sum, l) => sum + Number(l.labor_hours ?? 0), 0)
  return (
    <main className="approve">
      <div className="approve-box">
        <PlateLogo className="approve-logo" height={38} />
        <h1>
          {view.vehicle || "הרכב שלך"}
          {view.plate_last3 ? (
            <>
              {" "}
              <span className="approve-plate num" dir="ltr">···{view.plate_last3}</span>
            </>
          ) : null}
        </h1>
        <h2 className="approve-title">הצעת המחיר לעבודה שדיברנו עליה בקבלה</h2>

        {/* קישור שפג מחזיר רק סטטוס (058): בלי פריטים, ואז גם בלי סכום של 0 */}
        {view.lines.length > 0 && (
          <>
            <ul className="intake-lines">
              {view.lines.map((l, i) => (
                <li key={i}>
                  <b>{l.title}</b>
                  <span className="intake-price">{choiceAndPrice(l.part_choice, l.price_aftermarket, l.price)}</span>
                  <span className="intake-meta">
                    {l.labor_hours === null
                      ? ""
                      : Number(l.labor_hours) === 1
                        ? "שעת עבודה אחת צפויה"
                        : `${Number(l.labor_hours).toLocaleString("he-IL")} שעות עבודה צפויות`}
                    {l.warranty ? ` · אחריות: ${l.warranty}` : ""}
                  </span>
                  {l.price_aftermarket !== null && l.part_diff && <span className="intake-meta">ההבדל בין מקורי לחלופי: {l.part_diff}</span>}
                  {l.price_aftermarket === null && l.single_reason && <span className="intake-meta">{l.single_reason}</span>}
                </li>
              ))}
            </ul>
            <p className="intake-total">
              סה&quot;כ: <b className="num">{shekel(total)}</b> · כולל מע&quot;מ
              {hoursTotal > 0 ? ` · ${hoursTotal.toLocaleString("he-IL")} שעות עבודה` : ""}
            </p>
            <p className="intake-free">{FREE_INSPECTION}</p>
          </>
        )}

        {view.status === "approved" || view.status === "signed" ? (
          <div className="approve-done approved">
            <b>{view.status === "approved" ? "אישרת את ההצעה. מתחילים לעבוד על הרכב." : "ההצעה אושרה בחתימה על העותק המודפס."}</b>
            {view.decided_at && (
              <p className="approve-stamp">
                נרשם אצלנו בכתב, {fmtStamp(view.decided_at)}. אם יימצא ברכב משהו נוסף, נשלח אליך קישור כזה לפני שנוגעים בו.
              </p>
            )}
          </div>
        ) : view.status === "declined" ? (
          <div className="approve-done declined">
            <b>קיבלנו: לא לאשר את ההצעה.</b>
            <p className="approve-stamp">לא נוגעים ברכב. דניאל יתקשר אליך לדבר על זה. ({fmtStamp(view.decided_at)})</p>
          </div>
        ) : view.status === "expired" ? (
          <p className="approve-note">הקישור פג. אפשר להתקשר אלינו ונסדר את זה בטלפון.</p>
        ) : (
          <>
            <p className="approve-message">
              {view.customer ? `${view.customer}, ` : ""}נתחיל לעבוד על הרכב, כולל האבחון, רק אחרי שתאשר/י. אם יימצא משהו נוסף, נשלח אליך קישור
              נפרד, ולא נוגעים בזה בלי אישור שלך.
            </p>
            <IntakeForm token={token} needsTerms={Boolean(view.needs_terms)} />
          </>
        )}

        <p className="approve-small">
          המחירים כוללים חלקים, עבודה ומע&quot;מ. האישור כאן נרשם אצלנו בכתב, עם התאריך והשעה. שאלות: 055-3048489.
        </p>
      </div>
    </main>
  )
}

export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  const { data: intake } = await supabase.rpc("intake_view", { p_token: token })
  if (intake) return <IntakePage token={token} view={intake as Intake} />

  const { data: req } = await supabase.rpc("request_view", { p_token: token })
  if (Array.isArray(req) && req.length > 0) {
    // מה כבר אושר (בקבלה ובהודעות קודמות), כדי שהלקוח יחליט כשהוא יודע את הסכום הכולל (029).
    const { data: agreedRaw } = await supabase.rpc("request_agreed", { p_token: token })
    const a = (agreedRaw ?? {}) as { lines?: AgreedLine[]; approved?: AgreedLine[] }
    const agreed = [...(a.lines ?? []), ...(a.approved ?? [])].filter((l) => l && l.price !== null)
    const rows = req as RequestRow[]
    const photoUrls = await signPhotos(supabase, token, rows.filter((r) => !r.expired && !r.decision).flatMap((r) => r.photo_paths ?? []))
    return <RequestPage token={token} rows={rows} agreed={agreed} photoUrls={photoUrls} />
  }
  const { data } = await supabase.rpc("approval_view", { p_token: token })
  const view = (Array.isArray(data) ? data[0] : null) as View | null

  if (!view) {
    return (
      <main className="approve">
        <div className="approve-box">
          <h1>הקישור לא בתוקף</h1>
          <p>יכול להיות שהוא כבר שימש, או שעברו יותר משבוע. אפשר להתקשר אלינו ונסדר את זה.</p>
          <a className="btn" href="tel:0553048489">התקשרות למוסך</a>
        </div>
      </main>
    )
  }

  const decided = Boolean(view.decision)
  const photoUrls = view.expired ? {} : await signPhotos(supabase, token, view.photo_paths ?? [])
  const photos = (view.photo_paths ?? []).filter((p) => photoUrls[p])

  return (
    <main className="approve">
      <div className="approve-box">
        <PlateLogo className="approve-logo" height={38} />
        <h1>
          {view.vehicle || "הרכב שלך"}
          {view.plate_last3 ? (
            <>
              {" "}
              <span className="approve-plate num" dir="ltr">···{view.plate_last3}</span>
            </>
          ) : null}
        </h1>

        {view.title && <h2 className="approve-title">{view.title}</h2>}
        {view.safety && (
          <p className="approve-safety">זה ליקוי בטיחותי. אם לא מתקנים, אנחנו מחויבים לדווח עליו לרשות הרישוי.</p>
        )}

        {photos.length > 0 && (
          <div className="approve-photos">
            {photos.map((p, i) => (
              <a key={p} href={photoUrls[p]} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrls[p]} alt={`מה שהמכונאי צילם, תמונה ${i + 1}`} loading="lazy" />
              </a>
            ))}
          </div>
        )}

        <p className="approve-message">{view.message_text}</p>

        <dl className="approve-facts">
          {view.labor_hours !== null && (
            <>
              <dt>שעות עבודה צפויות</dt>
              <dd>{Number(view.labor_hours).toLocaleString("he-IL")}</dd>
            </>
          )}
          {view.eta && (
            <>
              <dt>אם מאשרים עכשיו, מוכן</dt>
              <dd>{view.eta}</dd>
            </>
          )}
        </dl>

        {view.part_diff && <p className="approve-diff">מה ההבדל בין מקורי לחלופי: {view.part_diff}</p>}
        {view.single_reason && <p className="approve-diff">{view.single_reason}</p>}

        {view.expired && !decided && <p className="approve-note">הקישור פג. אפשר להתקשר אלינו ונסדר את זה בטלפון.</p>}

        {decided ? (
          <div className={`approve-done ${view.decision}`}>
            {view.decision === "approved" ? (
              <>
                <b>קיבלנו את האישור שלך.</b>
                <p>
                  {partLabel(view.part_choice, view.price_aftermarket) || "אישרת את העבודה"}
                  {view.eta ? ` · הרכב יהיה מוכן ${view.eta}` : ""}
                </p>
              </>
            ) : (
              <>
                <b>רשמנו שלא אישרת את התיקון.</b>
                <p>נמשיך רק במה שסוכם קודם, ונעדכן כשהרכב מוכן.</p>
              </>
            )}
            <p className="approve-stamp">נרשם אצלנו בכתב, {fmtStamp(view.decided_at)}. אם השארת לנו מייל, הצעת המחיר המעודכנת נשלחת אליך לשם.</p>
          </div>
        ) : view.expired ? null : (
          <>
          {Number(view.discount_pct) > 0 && view.list_price_original !== null && (
            <p className="approve-discount">
              המחירים כוללים <b>הנחה של {Number(view.discount_pct).toLocaleString("he-IL")}%</b>. במחירון:{" "}
              <s className="num">{Number(view.list_price_original).toLocaleString("he-IL")} ש&quot;ח</s>
              {view.list_price_aftermarket !== null && (
                <>
                  , חלופי <s className="num">{Number(view.list_price_aftermarket).toLocaleString("he-IL")} ש&quot;ח</s>
                </>
              )}
              .
            </p>
          )}
          <ApproveForm
            token={token}
            priceOriginal={view.price_original}
            priceAftermarket={view.price_aftermarket}
            warrantyOriginal={view.warranty_original}
            warrantyAftermarket={view.warranty_aftermarket}
          />
          </>
        )}

        <p className="approve-small">
          המחירים כוללים חלקים, עבודה ומע&quot;מ. בלי האישור שלך לא נוגעים ברכב. אם משהו לא ברור, אנחנו כאן: 055-3048489.
        </p>
      </div>
    </main>
  )
}
