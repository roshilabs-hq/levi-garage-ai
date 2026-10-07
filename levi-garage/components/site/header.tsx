"use client"

import Link from "next/link"
import { PlateLogo } from "@/components/brand/plate-logo"
import { useEffect, useRef, useState } from "react"
import { Menu, X } from "lucide-react"

import { bookingLink, type Dict, type Lang } from "@/lib/site/dict"

const LANGS: { code: Lang; label: string; href: string }[] = [
  { code: "he", label: "עב", href: "/" },
  { code: "ar", label: "ع", href: "/ar" },
  { code: "ru", label: "Ру", href: "/ru" },
]

function LangLinks({ current, label }: { current: Lang; label: string }) {
  return (
    <nav className="langs" aria-label={label}>
      {LANGS.map((l) => (
        <a key={l.code} href={l.href} lang={l.code} aria-current={l.code === current ? "true" : undefined}>
          {l.label}
        </a>
      ))}
    </nav>
  )
}

// langs: בורר השפה של האתר. במרכז ההדרכה הוא מוסתר, כדי שלא ייראה כאילו הוא מחליף את שפת המדריך (6.10).
export function SiteHeader({ t, overPhoto = true, langs = true }: { t: Dict; overPhoto?: boolean; langs?: boolean }) {
  const [solid, setSolid] = useState(!overPhoto)
  const [open, setOpen] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)

  // Transparent only at the very top, over the photo. Solid from the first ~40px of scroll, so nothing
  // from the hero (buttons, the 1998) ever shows through the bar. IntersectionObserver, never a scroll listener.
  useEffect(() => {
    if (!overPhoto || !sentinel.current) return
    const io = new IntersectionObserver(([e]) => setSolid(!e.isIntersecting), { rootMargin: "-76px 0px 0px 0px" })
    io.observe(sentinel.current)
    return () => io.disconnect()
  }, [overPhoto])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [open])

  const home = t.lang === "he" ? "/" : `/${t.lang}`
  const links = [
    { href: `${home}#plate`, label: t.nav.plate },
    { href: `${home}#promise`, label: t.nav.promise },
    { href: `${home}#how`, label: t.nav.how },
    { href: `${home}#services`, label: t.nav.services },
    { href: `${home}#test`, label: t.nav.test },
    { href: `${home}#family`, label: t.nav.family },
    { href: `${home}#fleet`, label: t.nav.fleet },
    { href: `${home}#visit`, label: t.nav.visit },
  ]

  return (
    <>
      {/* מעביר פוקוס בלי לשנות את הכתובת. קישור רגיל מוסיף #main להיסטוריה, ואז "אחורה" בדפדפן נשאר באותו דף. */}
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          const main = document.getElementById("main")
          if (!main) return
          e.preventDefault()
          main.setAttribute("tabindex", "-1")
          main.focus()
        }}
      >
        {t.nav.skip}
      </a>
      <header className="site-header" data-solid={solid || open ? "" : undefined}>
        <div className="wrap nav">
          {/* בטלפון התפריט בתחילת השורה: מימין בעברית ובערבית, משמאל ברוסית (רועי, 7.10) */}
          <button className="menu-btn" aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? t.nav.close : t.nav.menu} onClick={() => setOpen((o) => !o)}>
            {open ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
          <Link className="brand" href={home}>
            <PlateLogo lang={t.lang} height={42} />
          </Link>
          <ul className="nav-links">
            {links.map((l) => (
              <li key={l.href}><a href={l.href} onClick={() => setSolid(true)}>{l.label}</a></li>
            ))}
          </ul>
          <div className="nav-end">
            {langs && <LangLinks current={t.lang} label={t.footer.langs} />}
            <a className="btn" href={bookingLink({}, t.lang)}>{t.nav.book}</a>
          </div>
        </div>
      </header>
      <div id="mobile-menu" className="mobile-menu" data-open={open ? "" : undefined} hidden={!open}>
        <ul>
          {links.map((l) => (
            <li key={l.href}><a href={l.href} onClick={() => { setOpen(false); setSolid(true) }}>{l.label}</a></li>
          ))}
        </ul>
        {langs && <LangLinks current={t.lang} label={t.footer.langs} />}
      </div>
      {overPhoto && <div ref={sentinel} aria-hidden style={{ position: "absolute", top: 0, height: 120, width: 1 }} />}
    </>
  )
}
