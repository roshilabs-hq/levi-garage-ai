#!/usr/bin/env bash
# פריסה של האתר (levi-garage) לייצור. רק האתר: לא הבוט, לא משתני סביבה, לא מיגרציות.
# שתי המלכודות של המחשב הזה מטופלות כאן, כדי שהפקודה תהיה זהה בכל פעם:
#  - VERCEL_TOKEN ישן בסביבה גובר על ההתחברות של ה-CLI
#  - שם המחשב בעברית שובר את כותרות ה-HTTP של Vercel (ascii-hostname.cjs)
# ההרשאה לפריסה בלי לשאול ניתנת לסקריפט הזה בלבד (.claude/settings.local.json).
set -euo pipefail
cd "$(dirname "$0")/.."
unset VERCEL_TOKEN
export NODE_OPTIONS="--require $(pwd)/scripts/ascii-hostname.cjs"
npx vercel --prod --yes
