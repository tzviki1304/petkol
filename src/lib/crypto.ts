// Password protection: PBKDF2 (SHA-256) -> AES-GCM 256. Everything runs on the device.

const enc = new TextEncoder()
const dec = new TextDecoder()
export const PBKDF2_ITERATIONS = 150_000
const VERIFY_TEXT = 'petkol-ok'

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(s)
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n))
}

export async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptString(key: CryptoKey, text: string): Promise<{ iv: string; data: string }> {
  const iv = randomBytes(12)
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text))
  return { iv: toB64(iv), data: toB64(data) }
}

export async function decryptString(key: CryptoKey, iv: string, data: string): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(data))
  return dec.decode(plain)
}

export interface LockMeta {
  salt: string
  iterations: number
  verify: { iv: string; data: string }
}

export async function createLock(password: string): Promise<{ key: CryptoKey; meta: LockMeta }> {
  const salt = randomBytes(16)
  const key = await deriveKey(password, salt)
  const verify = await encryptString(key, VERIFY_TEXT)
  return { key, meta: { salt: toB64(salt), iterations: PBKDF2_ITERATIONS, verify } }
}

/** Returns the key when the password is right, otherwise null. */
export async function openLock(password: string, meta: LockMeta): Promise<CryptoKey | null> {
  const key = await deriveKey(password, fromB64(meta.salt), meta.iterations)
  try {
    const text = await decryptString(key, meta.verify.iv, meta.verify.data)
    return text === VERIFY_TEXT ? key : null
  } catch {
    return null
  }
}
