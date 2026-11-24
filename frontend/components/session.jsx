"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { api } from "../lib/api"

const Session = createContext(null)

export function SessionProvider({ children }) {
  const [user, setUser] = useState(undefined)
  const [error, setError] = useState("")
  const refresh = useCallback(async () => {
    try {
      const data = await api("/auth/me")
      setUser(data.user)
      setError("")
    } catch (error) {
      setUser(null)
      setError(error.status === 401 ? "" : error.message)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  async function login(body) {
    const data = await api("/auth/login", { method: "POST", body })
    setError("")
    setUser(data.user)
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" })
    } catch (error) {
      if (error.status !== 401) throw error
    }
    setUser(null)
  }
  return <Session.Provider value={{ user, error, login, logout, refresh }}>{children}</Session.Provider>
}

export const useSession = () => useContext(Session)
