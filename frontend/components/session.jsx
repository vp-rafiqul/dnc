"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { api, setAccessToken } from "../lib/api"

const Session = createContext(null)

export function SessionProvider({ children }) {
  const [user, setUser] = useState(undefined)
  const [error, setError] = useState("")
  const revision = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++revision.current
    try {
      const data = await api("/auth/session", { method: "POST", sessionCookie: true })
      if (current !== revision.current) return
      setAccessToken(data.accessToken)
      setUser(data.user)
      setError("")
    } catch (error) {
      if (current !== revision.current) return
      setAccessToken(undefined)
      setUser(null)
      setError(error.status === 401 ? "" : error.message)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  async function login(body) {
    const data = await api("/auth/login", { method: "POST", body, sessionCookie: true })
    revision.current++
    setAccessToken(data.accessToken)
    setError("")
    setUser(data.user)
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST", sessionCookie: true })
    } catch (error) {
      if (error.status !== 401) throw error
    }
    revision.current++
    setAccessToken(undefined)
    setUser(null)
  }
  return <Session.Provider value={{ user, error, login, logout, refresh }}>{children}</Session.Provider>
}

export const useSession = () => useContext(Session)
