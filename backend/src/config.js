export function config(env = process.env) {
  if (!env.DATABASE_URL) throw new Error("Set DATABASE_URL in backend/.env")
  if (typeof env.JWT_SECRET !== "string" || Buffer.byteLength(env.JWT_SECRET) < 32) {
    throw new Error("Set JWT_SECRET to a random secret of at least 32 bytes")
  }
  const port = Number(env.PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !env.HOST) {
    throw new Error("Set HOST and a valid PORT in backend/.env")
  }
  if (!["true", "false"].includes(env.COOKIE_SECURE)) {
    throw new Error("Set COOKIE_SECURE to true or false in backend/.env")
  }

  return {
    databaseUrl: env.DATABASE_URL,
    jwtSecret: new TextEncoder().encode(env.JWT_SECRET),
    secureCookie: env.COOKIE_SECURE === "true",
    host: env.HOST,
    port,
  }
}
