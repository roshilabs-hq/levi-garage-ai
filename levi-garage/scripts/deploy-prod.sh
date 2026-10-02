#!/usr/bin/env bash
# פריסה של האתר (levi-garage) לייצור. רק האתר: לא הבוט, לא משתני סביבה, לא מיגרציות.
#
# זו הדרך היחידה לפרוס את האתר: Vercel לא מחובר למאגר הזה ב-GitHub (הוא מחובר
# לחשבון GitHub אחר), ולכן דחיפה לא פורסת. מריצים משורש המאגר, בדיוק כך:
#   bash levi-garage/scripts/deploy-prod.sh
# רועי התיר לפרוס בלי לשאול דרך הסקריפט הזה בלבד (.claude/settings.local.json, 2.10).
#
# ב-Vercel מוגדר Root Directory = levi-garage (2.10), ולכן מריצים משורש המאגר,
# ו-.vercelignore שבשורש משאיר בחוץ את כל השאר, כולל קבצי .env המקומיים.
# שתי המלכודות של המחשב הזה מטופלות כאן:
#  - VERCEL_TOKEN ישן בסביבה גובר על ההתחברות של ה-CLI
#  - שם המחשב בעברית שובר את כותרות ה-HTTP של Vercel (ascii-hostname.cjs)
set -euo pipefail
cd "$(dirname "$0")/.."
# ב-Git Bash ‏pwd מחזיר /c/...; ‏Node ב-Windows צריך C:/..., ולכן pwd -W כשיש
export NODE_OPTIONS="--require $(pwd -W 2>/dev/null || pwd)/scripts/ascii-hostname.cjs"
cd ..
unset VERCEL_TOKEN
# הפרויקט במפורש, כדי שה-CLI לא יציע לקשר את שורש המאגר לפרויקט חדש.
export VERCEL_ORG_ID=team_jPmGFy97S4lNbWq3qoNJUYqx
export VERCEL_PROJECT_ID=prj_BJKdF77HQ0Vq8yDAwTOI2XIuqAAZ
npx vercel --prod --yes
