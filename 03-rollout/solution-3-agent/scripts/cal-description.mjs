// מוסיף לתיאור של סוג התור (מופיע בדף ההזמנה ובמיילים של Cal.com) קישור לוואטסאפ (ממצא 5, 3.10).
// מספר הוואטסאפ הציבורי נקרא מקובץ זמני (garage-wa.txt), כדי שלא ייכתב לריפו. המפתח לא מודפס.
import fs from "node:fs"
const key = process.env.CAL_API_KEY
const headers = { Authorization: `Bearer ${key}`, "content-type": "application/json", "cal-api-version": "2024-06-14" }
const num = fs.readFileSync(process.env.TEMP + "/garage-wa.txt", "utf8").trim()
const text = encodeURIComponent("שלום, קבעתי עכשיו תור 🙂 אשמח לקבל תזכורת ועדכון כשהרכב מוכן")
const get = await (await fetch("https://api.cal.com/v2/event-types/7164398", { headers })).json()
const before = get.data.description ?? ""
fs.writeFileSync(process.env.TEMP + "/cal-desc-backup.txt", before)
if (before.includes("wa.me")) { console.log("already there"); process.exit(0) }
const line = `לעדכונים בוואטסאפ (תזכורת יום לפני, הצעת מחיר לאישור, "הרכב מוכן"): [שלחו לנו הודעה אחת](https://wa.me/${num}?text=${text}). ההודעה כבר כתובה, רק לשלוח.`
const r = await fetch("https://api.cal.com/v2/event-types/7164398", { method: "PATCH", headers, body: JSON.stringify({ description: `${before.trim()}\n\n${line}` }) })
const j = await r.json()
console.log(r.status, (j.data?.description ?? JSON.stringify(j).slice(0, 200)).replace(/wa\.me\/\d+/, "wa.me/…"))
