// הצעת המחיר, כפי שהלקוח מקבל אותה: במייל, בדף מודפס בדלפק, ובגרסאות שנשמרות.
//
// מקור אחד לשלושתם (private.quote_snapshot במסד), כדי שמה שנשלח, מה שהודפס
// ומה שנשמר יהיו אותו דבר. החוק (ס' 132(א)) דורש בהצעה: הפעולות, שעות העבודה
// הצפויות, סוגי החלקים שהוצעו והסבר ההבדל, היקף האחריות, והתשלום.

export type QuoteOption = {
  title: string
  labor_hours: number | null
  price_original: number | null
  price_aftermarket: number | null
  warranty_original: string | null
  warranty_aftermarket: string | null
  part_diff: string | null
  single_reason: string | null
  part_choice: "original" | "aftermarket" | null
  price: number | null
}

export type QuoteFinding = QuoteOption & {
  id: number
  text: string | null
  status: "sent" | "approved" | "declined"
  safety: boolean
  decided_at: string | null
  /** 020: הנחה שדניאל או אבי נתנו. המחיר כבר אחריה. */
  discount_pct?: number | null
}

export type QuoteSnapshot = {
  job: {
    id: number
    plate: string
    vehicle: string | null
    year: number | null
    customer: string | null
    odometer_km: number | null
    opened_at: string
  }
  lines: QuoteOption[]
  findings: QuoteFinding[]
}

// העסק בדוי, והפרטים בהתאם. לא ממציאים מספר רישיון מוסך.
export const GARAGE = {
  name: "מוסך לוי ובניו",
  address: "אזור התעשייה, קריית ביאליק",
  phone: "055-3048489",
  manager: "דניאל לוי",
  managerTitle: "מנהל מקצועי",
}
// במייל אין גופנים ואין SVG (Gmail ו-Outlook חוסמים), ולכן הלוחית היא תמונה.
// הכתובת קבועה: levi-garage.vercel.app ממשיכה לעבוד גם אחרי המעבר לדומיין.
const LOGO_URL = "https://levi-garage.vercel.app/brand/logo-plate.png"
/** הכתובת שהלקוח רואה בקישורים: הדומיין של המוסך. */
export const SITE_URL = "https://levi-garage.co.il"


const TZ = "Asia/Jerusalem"
const dateFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric" })
const stampFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })

export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${Number(n).toLocaleString("he-IL")} ש"ח`

export const hours = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${Number(n).toLocaleString("he-IL")} שע׳`

/**
 * סוג החלק — רק כשהייתה בחירה בין שניים. בעבודה בלבד (הכנה לטסט, אבחון, כיוון
 * פרונט) אין חלק, ו"חלק מקורי" שם רק מבלבל את הלקוח (רועי, 28.9).
 */
export function partLabel(choice: string | null | undefined, aftermarket: number | null | undefined) {
  if (aftermarket === null || aftermarket === undefined) return ""
  return choice === "aftermarket" ? "חלק חלופי" : "חלק מקורי"
}

/** "חלק חלופי, 468 ש"ח", או רק "350 ש"ח" כשאין בחירה. */
export const choiceAndPrice = (choice: string | null | undefined, aftermarket: number | null | undefined, price: number | null | undefined) =>
  [partLabel(choice, aftermarket), money(price)].filter(Boolean).join(", ")

/** מה שמשולם בפועל: שורות הקבלה + ממצאים שאושרו. ממצא שנדחה או ממתין לא נספר. */
export function totals(s: QuoteSnapshot) {
  const agreed = s.lines.reduce((sum, l) => sum + Number(l.price ?? 0), 0)
  const approved = s.findings.filter((f) => f.status === "approved").reduce((sum, f) => sum + Number(f.price ?? 0), 0)
  const pending = s.findings.filter((f) => f.status === "sent").length
  return { agreed, approved, total: agreed + approved, pending }
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

/**
 * המחיר והאחריות. שני סוגי חלקים: טבלה, והסוג שהלקוח בחר מודגש.
 * מחיר אחד (עבודה בלבד, טיפול): שורה אחת, בלי עמודת "סוג" (רועי, 30.9: "סוג: מחיר" לא אומר כלום).
 */
function priceHtml(o: QuoteOption, chosen: "original" | "aftermarket" | null) {
  if (o.price_aftermarket === null || o.price_aftermarket === undefined) {
    return `<div style="font-size:14px;margin-top:10px">מחיר כולל מע"מ: <b>${money(o.price_original)}</b> · אחריות: ${esc(o.warranty_original)}</div>`
  }
  const row = (key: "original" | "aftermarket", label: string, price: number | null, warranty: string | null) => {
    const on = chosen === key
    return `<tr${on ? ' style="font-weight:700;background:#fff7d6"' : ""}><td>${label}${on ? " ✓" : ""}</td><td>${money(price)}</td><td>${esc(warranty)}</td></tr>`
  }
  return `
    <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:14px" cellpadding="6">
      <tr style="background:#f1f3f0"><th align="right">חלק</th><th align="right">מחיר כולל מע"מ</th><th align="right">אחריות</th></tr>
      ${row("original", "מקורי", o.price_original, o.warranty_original)}
      ${row("aftermarket", "חלופי", o.price_aftermarket, o.warranty_aftermarket)}
    </table>`
}

function blockHtml(o: QuoteOption, status: string, chosen: "original" | "aftermarket" | null = null) {
  return `
  <div style="border:1px solid #d9ddd8;border-radius:10px;padding:14px 16px;margin:12px 0">
    <div style="font-weight:700;font-size:16px">${esc(o.title)}</div>
    <div style="color:#4f5b54;font-size:14px;margin-top:4px">${status}</div>
    ${priceHtml(o, chosen)}
    <div style="font-size:14px;margin-top:8px">שעות עבודה צפויות: <b>${hours(o.labor_hours)}</b></div>
    ${o.part_diff ? `<div style="font-size:14px;margin-top:6px;color:#4f5b54">ההבדל בין סוגי החלקים: ${esc(o.part_diff)}</div>` : ""}
    ${o.single_reason ? `<div style="font-size:14px;margin-top:6px;color:#4f5b54">${esc(o.single_reason)}</div>` : ""}
  </div>`
}

function findingStatus(f: QuoteFinding) {
  if (f.status === "approved")
    return `אושר על ידך${f.decided_at ? ` ב-${stampFmt.format(new Date(f.decided_at))}` : ""}: ${choiceAndPrice(f.part_choice, f.price_aftermarket, f.price)}${Number(f.discount_pct) > 0 ? ` (כולל הנחה של ${Number(f.discount_pct)}%)` : ""}`
  if (f.status === "declined") return `לא אושר על ידך${f.decided_at ? ` (${stampFmt.format(new Date(f.decided_at))})` : ""}. לא נבצע את העבודה הזו.`
  return "ממתין לתשובה שלך בקישור ששלחנו"
}

export type QuoteReason = "intake" | "update" | "resend"

/**
 * approveToken (036): בקבלה, כשההצעה יוצאת ללקוח לאישור בקישור. אז שורות הקבלה
 * "ממתינות לאישור שלך" ולא "סוכם", ובמייל כפתור לאישור.
 */
export function quoteEmail(s: QuoteSnapshot, version: number, reason: QuoteReason, approveToken?: string | null) {
  const t = totals(s)
  const approveLink = approveToken ? `${SITE_URL}/approve/${approveToken}` : null
  const lineStatus = (l: QuoteOption) =>
    `${approveLink ? "לאישור שלך" : "סוכם בקבלה"}: ${choiceAndPrice(l.part_choice, l.price_aftermarket, l.price)}`
  const car = [s.job.vehicle, s.job.year].filter(Boolean).join(" ")
  const subject =
    reason === "intake"
      ? `הצעת מחיר לרכב ${s.job.plate} | ${GARAGE.name}`
      : `הצעת המחיר עודכנה (גרסה ${version}) לרכב ${s.job.plate} | ${GARAGE.name}`

  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f5f2">
  <div style="max-width:640px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1b2620;direction:rtl;text-align:right">
    <img src="${LOGO_URL}" alt="${GARAGE.name}" width="200" height="60" style="display:block;border:0;height:60px;width:200px;font-size:20px;font-weight:700">
    <div style="color:#4f5b54;font-size:13px">${GARAGE.address} · ${GARAGE.phone}</div>
    <h1 style="font-size:22px;margin:22px 0 4px">${reason === "intake" ? "הצעת מחיר" : `הצעת מחיר מעודכנת · גרסה ${version}`}</h1>
    <div style="color:#4f5b54;font-size:14px">מספר ${s.job.id}-${version} · ${dateFmt.format(new Date())}</div>
    <p style="font-size:15px;margin:16px 0">
      שלום${s.job.customer ? ` ${esc(s.job.customer.split(" ")[0])}` : ""},<br>
      ${reason === "intake"
        ? approveLink
          ? "זו הצעת המחיר לעבודה שדיברנו עליה בקבלת הרכב. <b>נתחיל לעבוד על הרכב רק אחרי שתאשר אותה</b>, בכפתור שבסוף המייל או בקישור שקיבלת בוואטסאפ."
          : "זו הצעת המחיר לעבודה שסיכמנו בקבלת הרכב. בלי אישור שלך לא נבצע שום עבודה אחרת."
        : reason === "update"
          ? "עדכנו את הצעת המחיר לפי התשובה שלך בקישור. זו הגרסה המלאה והעדכנית."
          : "זו הצעת המחיר העדכנית לרכב שלך, לפי מה שסוכם ואושר עד עכשיו."}
    </p>
    <div style="background:#fff;border-radius:12px;padding:6px 16px 12px">
      <div style="font-size:14px;margin-top:10px">רכב: <b>${esc(car || "—")}</b> · מספר רישוי <b dir="ltr">${esc(s.job.plate)}</b>${s.job.odometer_km ? ` · ${Number(s.job.odometer_km).toLocaleString("he-IL")} ק"מ בקבלה` : ""}</div>
      ${s.lines.map((l) => blockHtml(l, lineStatus(l), l.part_choice)).join("")}
      ${s.findings.map((f) => blockHtml(f, findingStatus(f), f.status === "approved" ? f.part_choice : null)).join("")}
      <div style="font-size:16px;margin:14px 0 4px">${approveLink ? "סה\"כ לתשלום אחרי האישור" : "סה\"כ לתשלום לפי מה שסוכם ואושר"}: <b>${money(t.total)}</b> (כולל מע"מ)</div>
      ${t.pending ? `<div style="font-size:14px;color:#8a5a00">${t.pending === 1 ? "פריט אחד ממתין" : `${t.pending} פריטים ממתינים`} לתשובה שלך, ולא נכללים בסכום.</div>` : ""}
    </div>
    ${approveLink ? `<p style="margin:20px 0 6px"><a href="${approveLink}" style="display:inline-block;background:#f2c230;color:#1b2620;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px">לאישור ההצעה</a></p>
    <p style="font-size:13px;color:#4f5b54;margin:0">אותו קישור נשלח גם בוואטסאפ. הוא בתוקף שבוע. שאלות: ${GARAGE.phone}.</p>` : ""}
    <p style="font-size:13px;color:#4f5b54;margin-top:18px">
      ההצעה ניתנת לפי חוק רישוי שירותים ומקצועות בענף הרכב, התשע"ו-2016: לכל חלק הוצע יותר מסוג אחד כשהדבר אפשרי,
      עם הסבר על ההבדל, שעות העבודה הצפויות והאחריות. לא נבצע עבודה שלא מופיעה בהצעה הזו או בעדכון שאישרת.
      <br>${GARAGE.manager}, ${GARAGE.managerTitle}.
    </p>
    <p style="font-size:12px;color:#8a938d">אתר הדגמה לפרויקט גמר. העסק, האנשים והמחירים בדויים.</p>
  </div></body></html>`

  const line = (o: QuoteOption, status: string) =>
    [
      `• ${o.title} — ${status}`,
      o.price_aftermarket !== null && o.price_aftermarket !== undefined
        ? `  מקורי ${money(o.price_original)} (אחריות: ${o.warranty_original}) · חלופי ${money(o.price_aftermarket)} (אחריות: ${o.warranty_aftermarket})`
        : `  מחיר ${money(o.price_original)} (אחריות: ${o.warranty_original})`,
      `  שעות עבודה צפויות: ${hours(o.labor_hours)}`,
      o.part_diff ? `  ההבדל: ${o.part_diff}` : "",
      o.single_reason ? `  ${o.single_reason}` : "",
    ]
      .filter(Boolean)
      .join("\n")

  const text = [
    `${GARAGE.name} · ${GARAGE.address} · ${GARAGE.phone}`,
    reason === "intake" ? "הצעת מחיר" : `הצעת מחיר מעודכנת, גרסה ${version}`,
    `רכב ${car} · ${s.job.plate}`,
    "",
    ...s.lines.map((l) => line(l, lineStatus(l))),
    ...s.findings.map((f) => line(f, findingStatus(f))),
    "",
    `סה"כ לפי מה שסוכם ואושר: ${money(t.total)} כולל מע"מ`,
    ...(approveLink ? ["", `לאישור ההצעה: ${approveLink}`, "נתחיל לעבוד על הרכב רק אחרי שתאשר."] : []),
    `${GARAGE.manager}, ${GARAGE.managerTitle}`,
    "אתר הדגמה לפרויקט גמר. העסק, האנשים והמחירים בדויים.",
  ].join("\n")

  return { subject, html, text }
}

/**
 * כשדניאל שולח ממצאים לאישור (027): לצד הוואטסאפ, מייל עם אותו קישור.
 * בלי מחירים מפורטים במייל: הם, התמונות והבחירה בדף האישור, כדי שיהיה מקום אחד לאשר בו.
 */
export function requestEmail(input: {
  customer: string | null
  plate: string
  vehicle: string | null
  token: string
  items: { title: string; safety: boolean; from: number | null }[]
}) {
  const link = `${SITE_URL}/approve/${input.token}`
  const n = input.items.length
  const subject = `${n === 1 ? "מצאנו משהו ברכב" : `מצאנו ${n} דברים ברכב`} ${input.plate}: מחכה לאישור שלך | ${GARAGE.name}`
  const rows = input.items
    .map(
      (i) =>
        `<li style="margin:6px 0">${esc(i.title)}${i.safety ? ' <b style="color:#b3261e">· בטיחות</b>' : ""}${i.from !== null ? ` · החל מ-${money(i.from)}` : ""}</li>`,
    )
    .join("")
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f5f2">
  <div style="max-width:640px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1b2620;direction:rtl;text-align:right">
    <img src="${LOGO_URL}" alt="${GARAGE.name}" width="200" height="60" style="display:block;border:0;height:60px;width:200px;font-size:20px;font-weight:700">
    <div style="color:#4f5b54;font-size:13px">${GARAGE.address} · ${GARAGE.phone}</div>
    <h1 style="font-size:22px;margin:22px 0 8px">${n === 1 ? "מצאנו משהו ברכב שלך" : `מצאנו ${n} דברים ברכב שלך`}</h1>
    <p style="font-size:15px;margin:0 0 12px">שלום${input.customer ? ` ${esc(input.customer.split(" ")[0])}` : ""},<br>
      במהלך העבודה על ${esc(input.vehicle || "הרכב")} (<span dir="ltr">${esc(input.plate)}</span>) מצאנו:</p>
    <ul style="font-size:15px;padding-inline-start:20px;margin:0 0 16px">${rows}</ul>
    <p style="font-size:15px;margin:0 0 18px">בקישור יש תמונות, הסבר, מחיר ואחריות לכל אחד, ואפשר לאשר או לדחות כל דבר בנפרד. <b>בלי האישור שלך לא נוגעים בזה.</b></p>
    <a href="${link}" style="display:inline-block;background:#f2c230;color:#1b2620;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px">לצפייה ולאישור</a>
    <p style="font-size:13px;color:#4f5b54;margin-top:18px">אותו קישור נשלח גם בוואטסאפ. הוא בתוקף שבוע. שאלות: ${GARAGE.phone}.<br>${GARAGE.manager}, ${GARAGE.managerTitle}.</p>
    <p style="font-size:12px;color:#8a938d">אתר הדגמה לפרויקט גמר. העסק, האנשים והמחירים בדויים.</p>
  </div></body></html>`
  const text = [
    `${GARAGE.name} · ${GARAGE.phone}`,
    `במהלך העבודה על הרכב ${input.plate} מצאנו:`,
    ...input.items.map((i) => `• ${i.title}${i.safety ? " (בטיחות)" : ""}${i.from !== null ? ` · החל מ-${money(i.from)}` : ""}`),
    "",
    `לצפייה ולאישור: ${link}`,
    "בלי האישור שלך לא נוגעים בזה.",
  ].join("\n")
  return { subject, html, text }
}
