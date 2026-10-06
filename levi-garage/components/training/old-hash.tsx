"use client"

// קישורים מלפני 6.10, כשמרכז ההדרכה היה דף אחד עם לשוניות: /training#mechanic,
// /training#office/d6-pricing. מעבירים אותם למסלול ולמסך החדשים, כדי שאף קישור שכבר יצא לא יישבר.

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { trackOfRole } from "@/lib/training/tracks"

const ROLES = ["mechanic", "office", "owner", "screens", "customer"]

export function OldHash() {
  const router = useRouter()
  useEffect(() => {
    const [role, screen] = decodeURIComponent(location.hash.slice(1)).split("/")
    if (!ROLES.includes(role)) return
    router.replace(`/training/${trackOfRole(role)}${screen ? `/${screen}` : ""}`)
  }, [router])
  return null
}
