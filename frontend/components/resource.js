"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "../lib/api"

export function useResource(path, options) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const request = useRef(null)

  const reload = useCallback(async () => {
    if (!path) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const { signal } = controller
    setLoading(true)
    setResult(previous => previous?.path === path && previous.options === options
      ? { ...previous, error: "" } : null)
    try {
      const data = await api(path, { ...options, signal })
      if (!signal.aborted) setResult({ path, options, data, error: "" })
    } catch (error) {
      if (!signal.aborted) setResult({ path, options, data: null, error: error.message })
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [path, options])

  useEffect(() => {
    void reload()
    return () => request.current?.abort()
  }, [reload])

  const current = path && result?.path === path && result.options === options ? result : null
  return { data: current?.data ?? null, pending: Boolean(path && (loading || !current)), error: current?.error ?? "", reload }
}
