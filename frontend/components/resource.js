"use client"

import { useCallback, useEffect, useState } from "react"
import { api } from "../lib/api"

export function useResource(path) {
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(Boolean(path))

  const reload = useCallback(async (signal) => {
    if (!path) return
    setPending(true)
    setError("")
    try {
      const result = await api(path, { signal })
      if (!signal?.aborted) setData(result)
    } catch (error) {
      if (!signal?.aborted) setError(error.message)
    } finally {
      if (!signal?.aborted) setPending(false)
    }
  }, [path])

  useEffect(() => {
    const controller = new AbortController()
    void reload(controller.signal)
    return () => controller.abort()
  }, [reload])

  return { data, pending, error, reload }
}
