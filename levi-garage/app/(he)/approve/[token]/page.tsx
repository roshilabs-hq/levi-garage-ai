import type { Metadata } from "next"

import { partLabel } from "@/lib/staff/quote"
import { createClient } from "@/lib/supabase/server"
import { PlateLogo } from "@/components/brand/plate-logo"
import { ApproveForm } from "@/components/staff/approve-form"
import { RequestForm, type RequestItem } from "@/components/staff/request-form"
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

const photoUrl = (path: string) =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/shared-quotes/${path.split("/").map(encodeURIComponent).join("/")}`

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

function RequestPage({ token, rows, agreed }: { token: string; rows: RequestRow[]; agreed: AgreedLine[] }) {
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
                photos: (r.photo_paths ?? []).map(photoUrl),
                discount_pct: r.discount_pct,
                list_price_original: r.list_price_original,
                list_price_aftermarket: r.list_price_aftermarket,
              }))}
            />
          </>
        )}

        <p className="approve-small">
          המחירים כוללים חלקים, עבודה ומע"מ. בלי האישור שלך לא נוגעים ברכב. אם משהו לא ברור, אנחנו כאן: 055-3048489.
        </p>
      </div>
    </main>
  )
}

export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  const { data: req } = await supabase.rpc("request_view", { p_token: token })
  if (Array.isArray(req) && req.length > 0) {
    // מה כבר אושר (בקבלה ובהודעות קודמות), כדי שהלקוח יחליט כשהוא יודע את הסכום הכולל (029).
    const { data: agreedRaw } = await supabase.rpc("request_agreed", { p_token: token })
    const a = (agreedRaw ?? {}) as { lines?: AgreedLine[]; approved?: AgreedLine[] }
    const agreed = [...(a.lines ?? []), ...(a.approved ?? [])].filter((l) => l && l.price !== null)
    return <RequestPage token={token} rows={req as RequestRow[]} agreed={agreed} />
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
  const photos = view.photo_paths ?? []

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
              <a key={p} href={photoUrl(p)} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl(p)} alt={`מה שהמכונאי צילם, תמונה ${i + 1}`} loading="lazy" />
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
          המחירים כוללים חלקים, עבודה ומע"מ. בלי האישור שלך לא נוגעים ברכב. אם משהו לא ברור, אנחנו כאן: 055-3048489.
        </p>
      </div>
    </main>
  )
}
