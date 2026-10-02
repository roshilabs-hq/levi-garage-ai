// אמצע יום עבודה: רכבים על הליפטים, אחד שמחכה בחוץ, ואחד שגמור ועוד לא נאסף.
// בלי זה מפת המוסך מוצגת ריקה, ואי אפשר להראות מה היא עושה.
// הרצה: node --env-file=.env.local scripts/seed-demo-floor.mjs
//
// כל הזמנים יחסיים לרגע ההרצה ולא שעות קבועות, כדי שההדגמה תיראה נכון
// בכל שעה שבה מריצים אותה. השעונים עצמם נשמרים במסד על ידי טריגר, ולכן
// אי אפשר לקבוע אותם בהכנסה עצמה: מכניסים, ואז מעדכנים אותם בנפרד.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY
if (!url || !secret) {
  console.error("חסר NEXT_PUBLIC_SUPABASE_URL או SUPABASE_SECRET_KEY")
  process.exit(1)
}

const api = (path, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json", ...(init.headers || {}) },
  })

const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()
const ahead = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString()

// מתחילים נקי, כדי שהרצה שנייה לא תיצור כפילויות על אותו ליפט.
const wipe = await api(`/rest/v1/job_cards?id=gt.0`, { method: "DELETE" })
if (!wipe.ok) {
  console.error("מחיקת כרטיסים קודמים נכשלה:", wipe.status, await wipe.text())
  process.exit(1)
}

const bookingsRes = await api(`/rest/v1/bookings?cal_uid=like.demo-*&select=id,cal_uid,plate`)
const bookings = bookingsRes.ok ? await bookingsRes.json() : []
const bookingId = (uid) => bookings.find((b) => b.cal_uid === uid)?.id ?? null

// שלושה תאים תפוסים, אחד פנוי, ואחד שמחכה בחוץ. מצב שדניאל מזהה.
const FLOOR = [
  {
    cal_uid: "demo-day-1",
    plate: "8215376",
    customer_name: "רונית ברק",
    customer_phone: "0500000001",
    whatsapp_consent: true,
    vehicle_make: "סקודה צ'כיה",
    vehicle_model: "FABIA",
    vehicle_year: 2012,
    engine_code: "CBZ",
    fuel: "בנזין",
    lift: 1,
    status: "in_progress",
    openedAgo: 110,
    liftAgo: 95,
    statusAgo: 95,
  },
  {
    // זה הרכב שתוקע את התא: הלקוח לא ענה, והליפט תפוס בינתיים.
    cal_uid: "demo-day-2",
    plate: "5748301",
    customer_name: "עומר כהן",
    customer_phone: "0500000002",
    whatsapp_consent: true,
    vehicle_make: "יונדאי",
    vehicle_model: "TUCSON",
    vehicle_year: 2017,
    engine_code: "G4NA",
    fuel: "בנזין",
    lift: 2,
    status: "waiting_approval",
    openedAgo: 200,
    liftAgo: 190,
    statusAgo: 150,
  },
  {
    // המכונאי סיים ומחכה שדניאל ישלח. התא תפוס, ואנחנו לא עובדים:
    // זה בדיוק הזמן שהמסך היה מסתיר קודם, כי הכרטיס נראה "בעבודה".
    cal_uid: null,
    plate: "4471290",
    customer_name: "נטלי אבידן",
    customer_phone: "0500000006",
    whatsapp_consent: true,
    vehicle_make: "קיה",
    vehicle_model: "SPORTAGE",
    vehicle_year: 2018,
    fuel: "בנזין",
    lift: 3,
    status: "waiting_quote",
    openedAgo: 140,
    liftAgo: 130,
    statusAgo: 40,
  },
  {
    // נכנס בלי תור, ואין לו עדיין ליפט. בלי המפה אף אחד לא רואה אותו.
    cal_uid: null,
    plate: "74815302",
    customer_name: "סמיר חדאד",
    customer_phone: "0500000004",
    whatsapp_consent: false,
    vehicle_make: "מאזדה",
    vehicle_model: "3",
    vehicle_year: 2021,
    fuel: "בנזין",
    lift: null,
    status: "in_progress",
    openedAgo: 50,
    liftAgo: null,
    statusAgo: 50,
  },
  {
    // גמור. סיום טיפול מפנה את התא, ולכן הוא כבר לא על ליפט: הוא בחצר,
    // מחכה שהלקוח יגיע לקחת אותו.
    cal_uid: null,
    plate: "6304821",
    customer_name: "אבי מזרחי",
    customer_phone: "0500000005",
    whatsapp_consent: true,
    vehicle_make: "טויוטה",
    vehicle_model: "COROLLA",
    vehicle_year: 2016,
    fuel: "בנזין",
    lift: null,
    status: "ready",
    openedAgo: 260,
    liftAgo: null,
    statusAgo: 35,
  },
]

for (const car of FLOOR) {
  const row = {
    booking_id: car.cal_uid ? bookingId(car.cal_uid) : null,
    plate: car.plate,
    vehicle_make: car.vehicle_make,
    vehicle_model: car.vehicle_model,
    vehicle_year: car.vehicle_year,
    engine_code: car.engine_code ?? null,
    fuel: car.fuel,
    customer_name: car.customer_name,
    customer_phone: car.customer_phone,
    whatsapp_consent: car.whatsapp_consent,
    lift: car.lift,
    status: car.status,
    opened_at: ago(car.openedAgo),
    // 036: בלי אישור הלקוח על הצעת הקבלה, המסד לא נותן לרכב לעלות לליפט.
    // ברכבי ההדגמה הלקוח כבר אישר בקישור, כשהרכב התקבל.
    work_approved_at: ago(car.openedAgo),
    work_approved_via: "link",
    ready_at: car.status === "ready" ? ago(car.statusAgo) : null,
    notes: "הדגמה · מפת המוסך",
  }

  const res = await api(`/rest/v1/job_cards`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(row),
  })
  if (!res.ok) {
    console.error(`✗ ${car.plate}:`, res.status, await res.text())
    continue
  }

  const [created] = await res.json()

  // השעונים נקבעים בטריגר לרגע ההכנסה, ולכן מזיזים אותם אחורה בעדכון נפרד.
  // העדכון לא נוגע ב-lift ולא ב-status, ולכן הטריגר לא דורס אותו בחזרה.
  const patch = await api(`/rest/v1/job_cards?id=eq.${created.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      lift_since: car.liftAgo === null ? null : ago(car.liftAgo),
      status_since: ago(car.statusAgo),
    }),
  })
  if (!patch.ok) console.error(`✗ שעונים ל-${car.plate}:`, patch.status, await patch.text())

  if (car.cal_uid) await api(`/rest/v1/bookings?cal_uid=eq.${car.cal_uid}`, { method: "PATCH", body: JSON.stringify({ status: "arrived" }) })

  console.log(`✓ ${car.plate} · ${car.lift ? `ליפט ${car.lift}` : "בלי ליפט"} · ${car.status}`)
}

// תור אחד שעוד לא הגיע, כדי שגם "אמורים להגיע היום" לא יהיה ריק.
const soon = await api(`/rest/v1/bookings?cal_uid=eq.demo-day-3`, {
  method: "PATCH",
  body: JSON.stringify({ status: "booked", drop_off_at: ahead(45) }),
})
console.log(soon.ok ? "✓ תור אחד נותר, בעוד 45 דקות" : `✗ עדכון התור: ${soon.status}`)
