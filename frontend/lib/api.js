export async function api(path, { body, headers, ...options } = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    cache: "no-store",
    headers: { "X-DNC-Workspace": "1", ...(body && { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 204) return null
  const data = await response.json().catch(() => null)
  if (!response.ok || data === null) {
    const error = new Error(data?.error || "The API is unavailable. Try again shortly.")
    error.status = response.status
    throw error
  }
  return data
}

export function displayDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}
