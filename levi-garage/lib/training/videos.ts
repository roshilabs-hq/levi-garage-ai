// סרטוני ההדרכה במרכז ההדרכה (5.10). הקבצים ב-public/training/video. הפרקים מהקומפוזיציה
// (00-planning/videos/<id>/chapters.json), כדי שהאינדקס יקפוץ בדיוק לכרטיס הפרק.

import type { TrainingVideo } from "@/components/training/video"

export const VIDEOS: TrainingVideo[] = [
  {
    id: "day",
    title: "יום במוסך",
    who: "לכל הצוות: מהתור ועד המפתחות, בשני הצדדים",
    length: "5:29",
    src: "/training/video/day.mp4",
    poster: "/training/video/day.jpg",
    chapters: [
      { t: 0, title: "שבע בבוקר" },
      { t: 23, title: "הלקוח קובע תור" },
      { t: 56.6, title: "הבוקר של דניאל" },
      { t: 81.5, title: "קבלת רכב בדלפק" },
      { t: 122.3, title: "המכונאי ליד הליפט" },
      { t: 146.4, title: "אבחון ברמזור" },
      { t: 184.3, title: "הליפט לא מחכה" },
      { t: 209.9, title: "דניאל מתמחר: הודעה אחת" },
      { t: 235.7, title: "הלקוח מחליט בטלפון" },
      { t: 261.7, title: "חזרה לתור, וגמרנו" },
      { t: 287.4, title: "אבי, פעם בשבוע" },
      { t: 305.3, title: "כשמשהו לא עובד" },
    ],
  },
]
