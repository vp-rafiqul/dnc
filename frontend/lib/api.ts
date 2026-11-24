let accessToken: string | undefined

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown
  sessionCookie?: boolean
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong."
}

export function setAccessToken(token: string | undefined) {
  accessToken = token
}

export function apiUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_API_ENDPOINT}/api${path}`
}

export function api(path: string, options: ApiOptions & { responseType: "blob" }): Promise<Blob>
export function api<T = unknown>(path: string, options?: ApiOptions): Promise<T>
export async function api(path: string, { body, headers, sessionCookie = false, responseType = "json", ...options }: ApiOptions & {
  responseType?: "blob" | "json"
} = {}): Promise<unknown> {
  const requestHeaders = new Headers()
  if (accessToken) requestHeaders.set("Authorization", `Bearer ${accessToken}`)
  if (sessionCookie) requestHeaders.set("X-DNC-Workspace", "1")
  if (body !== undefined) requestHeaders.set("Content-Type", "application/json")
  new Headers(headers).forEach((value, name) => requestHeaders.set(name, value))
  const response = await fetch(apiUrl(path), {
    ...options,
    cache: "no-store",
    credentials: sessionCookie ? "include" : "omit",
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 204) return null
  if (response.ok && responseType === "blob") return response.blob()
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok || data === null) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error : "The API is unavailable. Try again shortly."
    throw new ApiError(message, response.status)
  }
  return data
}

export function displayDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}
