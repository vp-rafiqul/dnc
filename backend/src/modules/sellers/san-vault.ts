import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import type { Keyring } from "../../config.ts"

const version = 1

// Envelope: [format version][12-byte IV][16-byte GCM tag][ciphertext]. The key id is stored beside it
// so keys can rotate, and the seller id is bound as AAD so a ciphertext cannot be moved to another seller.
export function sanVault(keyring: Keyring) {
  return {
    encrypt(sellerId: string, san: string) {
      const key = keyring.keys.get(keyring.activeKeyId)!
      const iv = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", key, iv)
      cipher.setAAD(Buffer.from(`seller:${sellerId}`))
      const ciphertext = Buffer.concat([cipher.update(san, "utf8"), cipher.final()])
      return {
        keyId: keyring.activeKeyId,
        ciphertext: Buffer.concat([Buffer.of(version), iv, cipher.getAuthTag(), ciphertext]),
      }
    },
    decrypt(sellerId: string, keyId: string, stored: Uint8Array) {
      const key = keyring.keys.get(keyId)
      const envelope = Buffer.from(stored)
      if (!key || envelope[0] !== version) throw new Error("The SAN encryption key is unavailable.")
      const decipher = createDecipheriv("aes-256-gcm", key, envelope.subarray(1, 13))
      decipher.setAAD(Buffer.from(`seller:${sellerId}`))
      decipher.setAuthTag(envelope.subarray(13, 29))
      return Buffer.concat([decipher.update(envelope.subarray(29)), decipher.final()]).toString("utf8")
    },
  }
}

export const maskSan = (last4: string) => `•••• ${last4}`
