import { createHmac } from "node:crypto"

export function historySearch(key: Buffer) {
  function token(userId: string, digits: string) {
    return createHmac("sha256", key).update(`${userId}:${digits}`).digest("hex")
  }

  function tokensFor(userId: string, phone: string) {
    const fragments = new Set<string>()
    for (let start = 0; start < phone.length; start++) {
      for (let end = start + 1; end <= phone.length; end++) fragments.add(phone.slice(start, end))
    }
    return Array.from(fragments, digits => token(userId, digits))
  }

  return { token, tokensFor }
}
