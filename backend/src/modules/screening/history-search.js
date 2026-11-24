import { createHmac } from "node:crypto"

export function historySearch(key) {
  function token(userId, digits) {
    return createHmac("sha256", key).update(`${userId}:${digits}`).digest("hex")
  }

  function tokensFor(userId, phone) {
    const fragments = new Set()
    for (let start = 0; start < phone.length; start++) {
      for (let end = start + 1; end <= phone.length; end++) fragments.add(phone.slice(start, end))
    }
    return Array.from(fragments, digits => token(userId, digits))
  }

  return { token, tokensFor }
}
