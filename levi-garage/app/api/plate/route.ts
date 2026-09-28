import { NextResponse } from "next/server"

// בדיקת רכב לפי מספר רישוי, ממאגר כלי הרכב הציבורי של משרד התחבורה (data.gov.il).
// המספר לא נשמר ולא נרשם בלוג. מחזירים רק את השדות שהאתר מציג.

const RESOURCE = "053cea08-09bc-40ec-8f7a-156f0677aff3"

// המאגר הממשלתי איטי: תשובה ראשונה לוקחת 20 עד 30 שניות. התשובה נשמרת ליממה,
// ולכן רק הבקשה הראשונה לכל מספר משלמת את ההמתנה.
// משרד התחבורה כותב יצרן ומדינה יחד ("מיצובישי יפן"). לקוח אומר "מיצובישי".
// אותו כלל כמו במסד (021), כדי שהאתר והכרטיס יגידו אותו דבר.
const COUNTRY = /\s+(יפן|קוריאה|קוריאה הדרומית|צ'כיה|גרמניה|צרפת|ארה"ב|ארצות הברית|ספרד|איטליה|סין|טורקיה|בריטניה|אנגליה|הודו|תאילנד|רומניה|שבדיה|הונגריה|מקסיקו|סלובקיה|בלגיה|אוסטריה|פולין|פורטוגל|הולנד|קנדה|ברזיל|דרום אפריקה|מרוקו|אינדונזיה|טייוואן|מלזיה|סלובניה|סרביה|רוסיה|ארגנטינה|פינלנד)$/
const cleanMake = (v: string | null | undefined) => (v ? v.replace(COUNTRY, "").trim() || null : null)

export const maxDuration = 45

export async function GET(req: Request) {
  const plate = (new URL(req.url).searchParams.get("n") ?? "").replace(/\D/g, "")
  if (plate.length < 7 || plate.length > 8) {
    return NextResponse.json({ error: "invalid" }, { status: 400 })
  }

  const url = new URL("https://data.gov.il/api/3/action/datastore_search")
  url.searchParams.set("resource_id", RESOURCE)
  url.searchParams.set("filters", JSON.stringify({ mispar_rechev: Number(plate) }))
  url.searchParams.set("limit", "1")

  try {
    const res = await fetch(url, {
      headers: { "user-agent": "levi-garage-site/1.0 (+https://levi-garage.vercel.app)" },
      signal: AbortSignal.timeout(35000),
      next: { revalidate: 86400 },
    })
    if (!res.ok) throw new Error(String(res.status))
    let record = (await res.json())?.result?.records?.[0]

    // "לא נמצא" לא נשמר ליממה. בלי זה, תקלה אחת במאגר הממשלתי הייתה נתקעת
    // באתר עד למחרת. לכן בודקים שוב, בלי מטמון — ואם המאגר כולו ריק, זו
    // תקלה אצלם (קרה ב-25.9, אחרי טעינה מחדש של המאגר), לא רכב שלא קיים.
    if (!record) {
      const again = await fetch(url, { headers: { "user-agent": "levi-garage-site/1.0" }, signal: AbortSignal.timeout(35000), cache: "no-store" })
      record = again.ok ? (await again.json())?.result?.records?.[0] : undefined
    }
    if (!record) {
      const probe = new URL("https://data.gov.il/api/3/action/datastore_search")
      probe.searchParams.set("resource_id", RESOURCE)
      probe.searchParams.set("limit", "1")
      const empty = await fetch(probe, { signal: AbortSignal.timeout(20000), cache: "no-store" })
        .then((r) => r.json())
        .then((j) => (j?.result?.total ?? 0) === 0)
        .catch(() => true)
      if (empty) return NextResponse.json({ error: "upstream" }, { status: 502 })
      return NextResponse.json({ found: false })
    }

    return NextResponse.json({
      found: true,
      plate,
      make: cleanMake(record.tozeret_nm),
      model: record.kinuy_mishari ?? null,
      year: record.shnat_yitzur ?? null,
      fuel: record.sug_delek_nm ?? null,
      engine: record.degem_manoa ?? null,
      tires: record.zmig_kidmi ?? null,
      testUntil: record.tokef_dt ?? null,
    })
  } catch {
    return NextResponse.json({ error: "upstream" }, { status: 502 })
  }
}
