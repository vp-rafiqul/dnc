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
  const sanKeys = parseKeyring(env.SAN_ENCRYPTION_KEYS || "")
  const stripe = parseStripe(env)
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
    sanKeys,
    stripe,
    secureCookie: env.COOKIE_SECURE === "true",
    frontendOrigin,
    host: env.HOST,
    port,
  }
}

export type Config = ReturnType<typeof config>

export interface StripeConfig {
  secretKey: string
  webhookSecret: string | null
  apiBase: string
  /** When set, the card form opens inside the app (Stripe Embedded Checkout) instead of redirecting. */
  publishableKey: string | null
  /** Stripe's request_three_d_secure: "any" asks for 3D Secure whenever the card supports it. */
  threeDSecure: "automatic" | "any" | "challenge"
}

// Card payments stay disabled until STRIPE_SECRET_KEY is set.
function parseStripe(env: NodeJS.ProcessEnv): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim()
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || null
  const apiBase = (env.STRIPE_API_BASE?.trim() || "https://api.stripe.com").replace(/\/$/, "")
  if (!secretKey) {
    if (webhookSecret) throw new Error("Set STRIPE_SECRET_KEY together with STRIPE_WEBHOOK_SECRET in backend/.env")
    return null
  }
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) throw new Error("STRIPE_SECRET_KEY must be a Stripe secret key (sk_test_… or sk_live_…)")
  if (webhookSecret && !/^whsec_[A-Za-z0-9]+$/.test(webhookSecret)) throw new Error("STRIPE_WEBHOOK_SECRET must start with whsec_")
  if (!/^https?:\/\/[^/]+$/.test(apiBase)) throw new Error("STRIPE_API_BASE must be an origin such as https://api.stripe.com")
  const publishableKey = env.STRIPE_PUBLISHABLE_KEY?.trim() || null
  if (publishableKey) {
    if (!/^pk_(test|live)_[A-Za-z0-9]+$/.test(publishableKey)) throw new Error("STRIPE_PUBLISHABLE_KEY must be a Stripe publishable key (pk_test_… or pk_live_…)")
    if (publishableKey.slice(3, 7) !== secretKey.slice(3, 7)) throw new Error("STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY must both be test keys or both be live keys")
  }
  const threeDSecure = env.STRIPE_THREE_D_SECURE?.trim() || "any"
  if (threeDSecure !== "automatic" && threeDSecure !== "any" && threeDSecure !== "challenge") {
    throw new Error("STRIPE_THREE_D_SECURE must be automatic, any or challenge")
  }
  return { secretKey, webhookSecret, apiBase, publishableKey, threeDSecure }
}

export interface Keyring {
  activeKeyId: string
  keys: Map<string, Buffer>
}

// Format: "v2:<base64url 32 bytes>,v1:<base64url 32 bytes>". The first entry encrypts new values;
// later entries remain available to decrypt values written before a rotation.
function parseKeyring(value: string): Keyring {
  const message = "Set SAN_ENCRYPTION_KEYS to one or more id:key entries with random 32-byte base64url keys in backend/.env"
  const keys = new Map<string, Buffer>()
  for (const entry of value.split(",").map(item => item.trim()).filter(Boolean)) {
    const [id, secret = "", ...rest] = entry.split(":")
    const key = Buffer.from(secret, "base64url")
    if (rest.length || !/^[A-Za-z0-9_-]{1,32}$/.test(id) || keys.has(id) || key.length !== 32 || key.toString("base64url") !== secret) {
      throw new Error(message)
    }
    keys.set(id, key)
  }
  const activeKeyId = keys.keys().next().value
  if (!activeKeyId) throw new Error(message)
  return { activeKeyId, keys }
}
