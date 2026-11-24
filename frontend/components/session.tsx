"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import type { Credentials, Principal, SessionPayload } from "../../shared/contracts"
import { api, ApiError, errorMessage, setAccessToken } from "../lib/api"

interface SessionState {
  user: Principal | null | undefined
  error: string
  restoring: boolean
  login: (body: Credentials) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const Session = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionState["user"]>(undefined)
  const [error, setError] = useState("")
  const [restoring, setRestoring] = useState(false)
  const restoreRequest = useRef<Promise<void> | null>(null)
  const mounted = useRef(false)
  const revision = useRef(0)
  const refresh = useCallback(() => {
    if (restoreRequest.current) return restoreRequest.current
    const current = ++revision.current
    setRestoring(true)
    const task = api<SessionPayload>("/auth/session", { method: "POST", sessionCookie: true })
      .then(data => {
        if (!mounted.current || current !== revision.current) return
        setAccessToken(data.accessToken)
        setUser(data.user)
        setError("")
      })
      .catch((error: unknown) => {
        if (!mounted.current || current !== revision.current) return
        if (error instanceof ApiError && error.status === 401) {
          setAccessToken(undefined)
          setUser(null)
          setError("")
        } else {
          setError(errorMessage(error))
        }
      })
      .finally(() => {
        restoreRequest.current = null
        if (mounted.current) setRestoring(false)
      })
    restoreRequest.current = task
    return task
  }, [])
  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false }
  }, [refresh])

  async function login(body: Credentials) {
    const data = await api<SessionPayload>("/auth/login", { method: "POST", body, sessionCookie: true })
    revision.current++
    setAccessToken(data.accessToken)
    setError("")
    setUser(data.user)
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST", sessionCookie: true })
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error
    }
    revision.current++
    setAccessToken(undefined)
    setUser(null)
  }
  return <Session.Provider value={{ user, error, restoring, login, logout, refresh }}>{children}</Session.Provider>
}

export function useSession() {
  const session = useContext(Session)
  if (!session) throw new Error("SessionProvider is required.")
  return session
}

export function useWorkspaceUser() {
  const { user } = useSession()
  if (!user) throw new Error("A signed-in workspace user is required.")
  return user
}
