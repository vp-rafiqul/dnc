"use client"

import { createContext, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Moon, Sun } from "lucide-react"

type ColorTheme = "light" | "dark"
const Theme = createContext<{ theme: ColorTheme | null; apply: (value: ColorTheme) => void } | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ColorTheme | null>(null)
  useEffect(() => { setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light") }, [])

  function apply(value: ColorTheme) {
    setTheme(value)
    document.documentElement.dataset.theme = value
    try { localStorage.setItem("dnc-theme", value) } catch {}
  }
  return <Theme.Provider value={{ theme, apply }}>{children}</Theme.Provider>
}

export function ThemeSwitch() {
  const context = useContext(Theme)
  if (!context) throw new Error("ThemeProvider is required.")
  const { theme, apply } = context
  return (
    <div className="theme-switch" role="group" aria-label="Appearance">
      <button aria-pressed={theme === "light"} onClick={() => apply("light")}><Sun size={15} /> Light</button>
      <button aria-pressed={theme === "dark"} onClick={() => apply("dark")}><Moon size={15} /> Dark</button>
    </div>
  )
}
