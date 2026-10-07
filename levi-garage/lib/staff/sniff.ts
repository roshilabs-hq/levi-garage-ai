// סוג הקובץ לפי התוכן שלו, לא לפי מה שהדפדפן הצהיר (ביקורת אבטחה חיצונית, 7.10, ממצא 8).
// עד היום, קובץ קול עם סוג לא מוכר תויג "audio/webm" ונשמר ונשלח למודל, ותמונה נבדקה רק לפי
// הסוג שהדפדפן שלח. מה שלא מזוהה כאן נדחה.
//
// מכסה את מה שמכשירים באמת מקליטים: WebM (כרום, אנדרואיד), MP4/M4A (אייפון), Ogg (פיירפוקס),
// ו-MP3, AAC ו-WAV מקובץ שנבחר מהטלפון.

const ascii = (b: Uint8Array, at: number, s: string) => s.split("").every((c, i) => b[at + i] === c.charCodeAt(0))

export function sniffAudio(b: Uint8Array): string | null {
  if (b.length < 12) return null
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm"
  if (ascii(b, 0, "OggS")) return "audio/ogg"
  if (ascii(b, 4, "ftyp")) return "audio/mp4"
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE")) return "audio/wav"
  if (ascii(b, 0, "ID3")) return "audio/mpeg"
  // מסגרת MPEG בלי תגית: 11 ביטים של סנכרון. AAC בלי מעטפת (ADTS) נשמר כ-MP4 בדלי, כמו M4A.
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "audio/mp4"
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "audio/mpeg"
  return null
}

export function sniffPhoto(b: Uint8Array): string | null {
  if (b.length < 12) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"
  if (b[0] === 0x89 && ascii(b, 1, "PNG")) return "image/png"
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return "image/webp"
  return null
}
