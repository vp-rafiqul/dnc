"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

const Theme = createContext(null)

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(null)
  useEffect(() => { setTheme(document.documentElement.dataset.theme || "light") }, [])

  function apply(value) {
    setTheme(value)
    document.documentElement.dataset.theme = value
    try { localStorage.setItem("dnc-theme", value) } catch {}
  }
  return <Theme.Provider value={{ theme, apply }}>{children}</Theme.Provider>
}

export function ThemeSwitch() {
  const { theme, apply } = useContext(Theme)
  return (
    <div className="theme-switch" role="group" aria-label="Appearance">
      <button aria-pressed={theme === "light"} onClick={() => apply("light")}><Sun size={15} /> Light</button>
      <button aria-pressed={theme === "dark"} onClick={() => apply("dark")}><Moon size={15} /> Dark</button>
    </div>
  )
}
