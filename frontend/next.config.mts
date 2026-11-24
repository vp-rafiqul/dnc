import type { NextConfig } from "next"

const apiEndpoint = process.env.API_ENDPOINT
if (!apiEndpoint) throw new Error("Set API_ENDPOINT in frontend/.env")
const endpoint = new URL(apiEndpoint)
if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
  throw new Error("API_ENDPOINT must be an HTTP(S) origin, such as http://127.0.0.1:4000")
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Browser log forwarding triggered repeated reloads in the Windows dev server.
  logging: { browserToTerminal: false },
  env: { NEXT_PUBLIC_API_ENDPOINT: endpoint.origin },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${endpoint.origin}/api/:path*` }]
  },
}

export default nextConfig
