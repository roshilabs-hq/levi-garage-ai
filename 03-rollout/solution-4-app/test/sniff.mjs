// בודק את lib/staff/sniff.ts (ביקורת אבטחה חיצונית, 7.10, ממצא 8): הסוג נקבע לפי תוכן הקובץ.
// כל פורמט שמכשירים באמת מקליטים עובר, וקובץ שמתחזה לקול או לתמונה נדחה.
//
// הרצה: node 03-rollout/solution-4-app/test/sniff.mjs

import { sniffAudio, sniffPhoto } from "../../../levi-garage/lib/staff/sniff.ts"

let pass = 0
let fail = 0
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++
    console.log(`PASS  ${name}`)
  } else {
    fail++
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`)
  }
}
const bytes = (...parts) => {
  const out = []
  for (const p of parts) typeof p === "string" ? out.push(...Buffer.from(p, "latin1")) : out.push(...p)
  while (out.length < 32) out.push(0)
  return Uint8Array.from(out)
}

// קול
ok("WebM (כרום, אנדרואיד)", sniffAudio(bytes([0x1a, 0x45, 0xdf, 0xa3])) === "audio/webm")
ok("MP4/M4A (אייפון)", sniffAudio(bytes([0, 0, 0, 0x20], "ftypM4A ")) === "audio/mp4")
ok("Ogg (פיירפוקס)", sniffAudio(bytes("OggS")) === "audio/ogg")
ok("WAV", sniffAudio(bytes("RIFF", [0, 0, 0, 0], "WAVE")) === "audio/wav")
ok("MP3 עם תגית", sniffAudio(bytes("ID3")) === "audio/mpeg")
ok("MP3 בלי תגית", sniffAudio(bytes([0xff, 0xfb, 0x90])) === "audio/mpeg")
ok("AAC בלי מעטפת", sniffAudio(bytes([0xff, 0xf1, 0x50])) === "audio/mp4")
ok("טקסט שמתחזה לקול: נדחה", sniffAudio(bytes("hello, this is not audio at all")) === null)
ok("HTML שמתחזה לקול: נדחה", sniffAudio(bytes("<html><script>alert(1)</script>")) === null)
ok("תמונה שנשלחה כקול: נדחית", sniffAudio(bytes([0xff, 0xd8, 0xff, 0xe0])) === null)
ok("קובץ קצר מדי: נדחה", sniffAudio(Uint8Array.from([0x1a, 0x45])) === null)

// תמונה
ok("JPEG", sniffPhoto(bytes([0xff, 0xd8, 0xff, 0xe0])) === "image/jpeg")
ok("PNG", sniffPhoto(bytes([0x89], "PNG\r\n")) === "image/png")
ok("WebP", sniffPhoto(bytes("RIFF", [0, 0, 0, 0], "WEBP")) === "image/webp")
ok("SVG שמתחזה לתמונה: נדחה", sniffPhoto(bytes('<svg xmlns="http://www.w3.org/2000/svg">')) === null)
ok("WAV שנשלח כתמונה: נדחה", sniffPhoto(bytes("RIFF", [0, 0, 0, 0], "WAVE")) === null)
ok("טקסט שמתחזה לתמונה: נדחה", sniffPhoto(bytes("just some text pretending")) === null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
