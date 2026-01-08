/**
 * Crypto utilities for encrypting/decrypting sensitive data
 * Uses AES-256-GCM for authenticated encryption
 */

import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const SALT = 'system-app-salt'

// Derive a 32-byte key from the secret
function getKey() {
  const secret = process.env.ENCRYPTION_SECRET || 'dev-secret-key-change-in-production'
  return crypto.scryptSync(secret, SALT, 32)
}

/**
 * Encrypt a string using AES-256-GCM
 * @param {string} text - The plaintext to encrypt
 * @returns {string} - Base64 encoded encrypted data (iv + authTag + ciphertext)
 */
export function encrypt(text) {
  if (!text) return ''

  const key = getKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ])
  const authTag = cipher.getAuthTag()

  // Combine: iv (16 bytes) + authTag (16 bytes) + encrypted data
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

/**
 * Decrypt a string that was encrypted with encrypt()
 * @param {string} data - Base64 encoded encrypted data
 * @returns {string} - The decrypted plaintext
 */
export function decrypt(data) {
  if (!data) return ''

  try {
    const key = getKey()
    const buf = Buffer.from(data, 'base64')

    // Extract: iv (16 bytes) + authTag (16 bytes) + encrypted data
    const iv = buf.subarray(0, 16)
    const authTag = buf.subarray(16, 32)
    const encrypted = buf.subarray(32)

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8')
  } catch (e) {
    console.error('[crypto] Decryption failed:', e.message)
    return ''
  }
}
