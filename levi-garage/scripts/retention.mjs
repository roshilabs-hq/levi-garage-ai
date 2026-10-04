// מחיקה לפי מדיניות הפרטיות (בדיקת ציות, 4.10): מה שהמדיניות מבטיחה שיימחק, נמחק.
//
//   1. התמונות שנשלחו ללקוח (הדלי shared-quotes), כשהקישור שלהן פג. אחרי שפג ממילא
//      אי אפשר לפתוח אותן (049); כאן הן נמחקות גם מהאחסון.
//   2. ביקור שהסתיים לפני יותר מ-3 שנים: הכרטיס וכל מה שתלוי בו (ממצאים, אישורים,
//      הצעות מחיר, תמונות והקלטות), והתור שממנו הגיע.
//   3. תור ישן מ-3 שנים שלא הפך לביקור.
//
// הרצה, מתיקיית levi-garage (פעם בחודש):
//   node --env-file=.env.local scripts/retention.mjs           # רק מציג מה יימחק
//   node --env-file=.env.local scripts/retention.mjs --apply   # מוחק
//
// שלוש שנים מכסות גם את החובה לשמור הצעת מחיר שנה לפחות.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error("חסר NEXT_PUBLIC_SUPABASE_URL או SUPABASE_SECRET_KEY (.env.local)")
const apply = process.argv.includes("--apply")
const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }
const api = async (path, init = {}) => {
  const res = await fetch(`${url}${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } })
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path.split("?")[0]}: ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json().catch(() => null)
}
const rest = (path, init) => api(`/rest/v1/${path}`, init)
const del = (path) => rest(path, { method: "DELETE" })
const removeFiles = async (bucket, paths) => {
  for (let i = 0; i < paths.length; i += 500) {
    await api(`/storage/v1/object/${bucket}`, { method: "DELETE", body: JSON.stringify({ prefixes: paths.slice(i, i + 500) }) })
  }
}
const inList = (ids) => `in.(${ids.join(",")})`

const now = new Date()
const cutoff = new Date(now)
cutoff.setFullYear(cutoff.getFullYear() - 3)
const nowIso = now.toISOString()
const cutoffIso = cutoff.toISOString()

// ---------------------------------------------------------------- 1. תמונות של קישורים שפגו
const expired = (await rest(`approvals?expires_at=lt.${nowIso}&photo_paths=not.is.null&select=id,photo_paths`)) ?? []
const expiredPhotos = expired.flatMap((a) => a.photo_paths ?? [])
console.log(`תמונות של קישורים שפגו: ${expiredPhotos.length} (ב-${expired.length} אישורים)`)
if (apply && expiredPhotos.length) {
  await removeFiles("shared-quotes", expiredPhotos)
  await rest(`approvals?id=${inList(expired.map((a) => a.id))}`, { method: "PATCH", body: JSON.stringify({ photo_paths: null }) })
}

// ---------------------------------------------------------------- 2. ביקורים בני יותר מ-3 שנים
// הביקור הסתיים: נמסר, ואם לא נרשמה מסירה, העדכון האחרון בכרטיס.
const jobs =
  (await rest(`job_cards?or=(delivered_at.lt.${cutoffIso},and(delivered_at.is.null,updated_at.lt.${cutoffIso}))&select=id,booking_id`)) ?? []
console.log(`ביקורים שהסתיימו לפני ${cutoffIso.slice(0, 10)}: ${jobs.length}`)
if (apply && jobs.length) {
  for (let i = 0; i < jobs.length; i += 100) {
    const ids = jobs.slice(i, i + 100).map((j) => j.id)
    const media = (await rest(`media?job_card_id=${inList(ids)}&select=storage_path`)) ?? []
    await removeFiles("job-media", media.map((m) => m.storage_path).filter(Boolean))
    const fs = (await rest(`findings?job_card_id=${inList(ids)}&select=id`)) ?? []
    if (fs.length) {
      const fids = fs.map((f) => f.id)
      const shared = ((await rest(`approvals?finding_id=${inList(fids)}&select=photo_paths`)) ?? []).flatMap((a) => a.photo_paths ?? [])
      if (shared.length) await removeFiles("shared-quotes", shared)
      await del(`approvals?finding_id=${inList(fids)}`)
    }
    for (const t of ["media", "findings", "job_moves", "customer_notices", "quote_items", "quote_versions", "quote_requests", "help_calls", "inspections", "mentor_questions"]) {
      await del(`${t}?job_card_id=${inList(ids)}`)
    }
    await del(`job_cards?id=${inList(ids)}`)
    const bookings = jobs.slice(i, i + 100).map((j) => j.booking_id).filter(Boolean)
    if (bookings.length) {
      await del(`customer_notices?booking_id=${inList(bookings)}`)
      await del(`bookings?id=${inList(bookings)}`)
    }
  }
}

// ---------------------------------------------------------------- 3. תורים ישנים שלא הפכו לביקור
const oldBookings = (await rest(`bookings?drop_off_at=lt.${cutoffIso}&select=id,job_cards(id)`)) ?? []
const orphan = oldBookings.filter((b) => !b.job_cards || b.job_cards.length === 0).map((b) => b.id)
console.log(`תורים מלפני ${cutoffIso.slice(0, 10)} בלי ביקור: ${orphan.length}`)
if (apply && orphan.length) {
  for (let i = 0; i < orphan.length; i += 100) {
    const ids = orphan.slice(i, i + 100)
    await del(`customer_notices?booking_id=${inList(ids)}`)
    await del(`bookings?id=${inList(ids)}`)
  }
}

console.log(apply ? "נמחק." : "זו הייתה הצגה בלבד. למחיקה: --apply")
