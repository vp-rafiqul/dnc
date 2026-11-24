const endpoint = new URL(process.env.API_ENDPOINT)
if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
  throw new Error("API_ENDPOINT must be an HTTP(S) origin, such as http://127.0.0.1:4000")
}

export default {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_API_ENDPOINT: endpoint.origin },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${endpoint.origin}/api/:path*` }]
  },
}
