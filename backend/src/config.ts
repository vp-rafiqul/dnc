export function config(env: NodeJS.ProcessEnv = process.env) {
  if (!env.DATABASE_URL) throw new Error("Set DATABASE_URL in backend/.env")
  if (typeof env.JWT_SECRET !== "string" || Buffer.byteLength(env.JWT_SECRET) < 32) {
    throw new Error("Set JWT_SECRET to a random secret of at least 32 bytes")
  }
  const encryptionSecret = env.API_KEY_ENCRYPTION_SECRET || ""
  const apiKeyEncryptionKey = Buffer.from(encryptionSecret, "base64url")
  if (apiKeyEncryptionKey.length !== 32 || apiKeyEncryptionKey.toString("base64url") !== encryptionSecret) {
    throw new Error("Set API_KEY_ENCRYPTION_SECRET to a random 32-byte base64url value in backend/.env")
  }
  const historySearchSecret = env.HISTORY_SEARCH_SECRET || ""
  const historySearchKey = Buffer.from(historySearchSecret, "base64url")
  if (historySearchKey.length !== 32 || historySearchKey.toString("base64url") !== historySearchSecret) {
    throw new Error("Set HISTORY_SEARCH_SECRET to a random 32-byte base64url value in backend/.env")
  }
  const port = Number(env.PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !env.HOST) {
    throw new Error("Set HOST and a valid PORT in backend/.env")
  }
  if (env.COOKIE_SECURE !== "true" && env.COOKIE_SECURE !== "false") {
    throw new Error("Set COOKIE_SECURE to true or false in backend/.env")
  }
  const frontendOrigin = env.FRONTEND_ORIGIN
  if (!frontendOrigin || !/^https?:\/\//.test(frontendOrigin) || new URL(frontendOrigin).origin !== frontendOrigin) {
    throw new Error("Set FRONTEND_ORIGIN to the frontend origin in backend/.env")
  }

  return {
    databaseUrl: env.DATABASE_URL,
    jwtSecret: new TextEncoder().encode(env.JWT_SECRET),
    apiKeyEncryptionKey,
    historySearchKey,
    secureCookie: env.COOKIE_SECURE === "true",
    frontendOrigin,
    host: env.HOST,
    port,
  }
}

export type Config = ReturnType<typeof config>
