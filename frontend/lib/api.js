let accessToken

export function setAccessToken(token) {
  accessToken = token
}

export function apiUrl(path) {
  return `${process.env.NEXT_PUBLIC_API_ENDPOINT}/api${path}`
}

export async function api(path, { body, headers, sessionCookie = false, responseType = "json", ...options } = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    cache: "no-store",
    credentials: sessionCookie ? "include" : "omit",
    headers: {
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      ...(sessionCookie && { "X-DNC-Workspace": "1" }),
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 204) return null
  if (response.ok && responseType === "blob") return response.blob()
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
