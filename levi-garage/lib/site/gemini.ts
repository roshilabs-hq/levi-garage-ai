import "server-only"

import crypto from "node:crypto"
import fs from "node:fs"

// Gemini דרך Vertex AI עם service account, כדי שהחיוב יירד מהקרדיט של GCP.
// מקור המפתח: GEMINI_SA_JSON (תוכן ה-JSON, ל-Vercel) או GEMINI_SA (נתיב לקובץ, לפיתוח מקומי).

type ServiceAccount = { client_email: string; private_key: string; project_id: string }

let cached: { token: string; exp: number; project: string } | null = null

function loadServiceAccount(): ServiceAccount {
  const inline = process.env.GEMINI_SA_JSON
  if (inline) return JSON.parse(inline)
  const path = process.env.GEMINI_SA
  if (path) return JSON.parse(fs.readFileSync(path, "utf8"))
  throw new Error("Gemini is not configured (GEMINI_SA_JSON or GEMINI_SA)")
}

async function accessToken() {
  if (cached && cached.exp > Date.now() + 60_000) return cached
  const sa = loadServiceAccount()
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url")
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error("Gemini auth failed")
  cached = { token: json.access_token, exp: Date.now() + json.expires_in * 1000, project: sa.project_id }
  return cached
}

// חלק בתוכן: טקסט, או קובץ (אודיו מהמכונאי, ותמונה שצילם).
export type Part = { text: string } | { audio: { data: string; mime: string } } | { image: { data: string; mime: string } }

function toApiPart(p: Part) {
  if ("text" in p) return { text: p.text }
  const file = "audio" in p ? p.audio : p.image
  return { inlineData: { mimeType: file.mime, data: file.data } }
}

export async function generateJson<T>(opts: {
  model?: string
  system: string
  contents: { role: "user" | "model"; text?: string; parts?: Part[] }[]
  schema: object
  temperature?: number
  timeoutMs?: number
  maxOutputTokens?: number
}): Promise<T> {
  const { token, project } = await accessToken()
  const model = opts.model ?? "gemini-2.5-flash"
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: opts.contents.map((c) => ({
      role: c.role,
      parts: c.parts ? c.parts.map(toApiPart) : [{ text: c.text ?? "" }],
    })),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 800,
      // אפשר לכבות "חשיבה" רק ב-flash. ב-pro זה מוחזר כשגיאה 400,
      // ולכן ב-pro פשוט לא שולחים את השדה.
      ...(model.includes("flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  })
  // 7.10: בבדיקה חוזרת, 5 מתוך 6 קריאות לבוט ההדרכה קיבלו 429 "Resource exhausted" מהמאגר הגלובלי
  // של Gemini (עומס אצל Google, לא מכסה שלנו). דקה אחר כך הכול עבר. לכן, על 429, 500 או 503
  // מנסים פעם אחת באזור באירופה, שיש לו מאגר משאבים נפרד. על חריגת זמן לא, כדי לא להכפיל המתנה.
  let json: {
    error?: { code?: number; message?: string }
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[]
  } = {}
  for (const loc of ["global", "europe-west1"]) {
    const host = loc === "global" ? "aiplatform.googleapis.com" : `${loc}-aiplatform.googleapis.com`
    const res = await fetch(`https://${host}/v1/projects/${project}/locations/${loc}/publishers/google/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body,
      // הודעה קולית ב-pro לוקחת כ-17 שניות לפי ה-POC, ולכן זמן ההמתנה ארוך יותר.
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    })
    json = await res.json()
    if (!json.error || ![429, 500, 503].includes(Number(json.error.code))) break
    console.error(`Gemini ${json.error.code} in ${loc}${loc === "global" ? ", trying europe-west1" : ""}`)
  }
  if (json.error) throw new Error(`Gemini ${json.error.code}: ${json.error.message ?? ""}`.trim())
  const candidate = json.candidates?.[0]
  const text = candidate?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("")
  // ב-pro גם ה"חשיבה" נגרעת מתקציב הפלט, ולכן תקציב קטן מדי מחזיר JSON חתוך באמצע.
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`Gemini stopped: ${candidate.finishReason}`)
  }
  if (!text) throw new Error("Gemini empty response")
  return JSON.parse(text) as T
}
