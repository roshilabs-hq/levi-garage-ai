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
  {
    id: "flow",
    title: "רכב אחד, שני מסכים",
    who: "לכולם: מימין הטלפון של הלקוחה, משמאל המוסך, באותו רגע",
    length: "2:04",
    src: "/training/video/flow.mp4",
    poster: "/training/video/flow.jpg",
    chapters: [
      { t: 0, title: "רכב אחד, שני מסכים" },
      { t: 15.2, title: "התור" },
      { t: 29.3, title: "הדלפק · 07:30" },
      { t: 43.5, title: "הליפט · 08:15" },
      { t: 60.1, title: "הודעה אחת · 09:12" },
      { t: 73, title: "דנה מחליטה · 09:48" },
      { t: 94.6, title: "מוכן · 14:46" },
      { t: 106.2, title: "אפס שיחות" },
    ],
  },
  {
    id: "exam",
    title: "המסמך, ואיך בוחנים בעצמכם",
    who: "לבוחני הפרויקט: מה כתוב במסמך ההגשה, ואיך בודקים את המוסך בעצמכם",
    length: "3:36",
    src: "/training/video/exam.mp4",
    poster: "/training/video/exam.jpg",
    chapters: [
      { t: 0, title: "המסמך" },
      { t: 20, title: "שלב C: בירור" },
      { t: 47.6, title: "שלב O: תכנון" },
      { t: 72, title: "שלב R: ארבעת הפתרונות, חיים" },
      { t: 126.4, title: "שלב R: אבטחה, בדיקות וגרסאות" },
      { t: 147.1, title: "שלב E: המסירה" },
      { t: 166.7, title: "איך בוחנים בעצמכם" },
      { t: 205, title: "מוסך לוי ובניו" },
    ],
  },
]
