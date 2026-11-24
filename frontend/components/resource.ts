"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { api, errorMessage } from "../lib/api"
import type { ApiOptions } from "../lib/api"

interface ResourceResult<T> {
  path: string
  options?: ApiOptions
  data: T | null
  error: string
}

export function useResource<T>(path: string | null, options?: ApiOptions) {
  const [result, setResult] = useState<ResourceResult<T> | null>(null)
  const [loading, setLoading] = useState(false)
  const request = useRef<AbortController | null>(null)

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
      const data = await api<T>(path, { ...options, signal })
      if (!signal.aborted) setResult({ path, options, data, error: "" })
    } catch (error) {
      if (!signal.aborted) setResult({ path, options, data: null, error: errorMessage(error) })
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
