import "./styles.css"
import type { Metadata } from "next"
import type { ReactNode } from "react"
import { ThemeProvider } from "../components/theme"
import { SessionProvider } from "../components/session"

export const metadata: Metadata = {
  title: { default: "DNC Screening", template: "%s | DNC Screening" },
  description: "Screen phone numbers against the synthetic Do Not Call dataset.",
}

const initializeTheme = `try {
  const saved = localStorage.getItem("dnc-theme");
  document.documentElement.dataset.theme = saved === "dark" || saved === "light"
    ? saved
    : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch {}`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: initializeTheme }} /></head>
      <body>
        <ThemeProvider><SessionProvider>{children}</SessionProvider></ThemeProvider>
      </body>
    </html>
  )
}
