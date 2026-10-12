import bcrypt from "https://esm.sh/bcryptjs@2.4.3";

// Support both ESM default and namespace exports across Deno runtimes
const bcryptLib: any = bcrypt?.compare ? bcrypt : (bcrypt as any)?.default ?? bcrypt;

export const BCRYPT_SALT_ROUNDS = 12;

/**
 * Computes legacy unsalted SHA-256 hex string.
 * Retained strictly for backward-compatible verification of unmigrated accounts.
 */
export async function legacySha256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Checks whether a given string is a standard bcrypt hash ($2a$, $2b$, or $2y$).
 */
export function isBcryptHash(hash: string): boolean {
  if (typeof hash !== "string") return false;
  return hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$");
}

/**
 * Hashes a plaintext password using bcrypt with cost factor 12.
 */
export async function hashPassword(password: string): Promise<string> {
  const clean = password.trim();
  if (bcryptLib?.hash) {
    return await bcryptLib.hash(clean, BCRYPT_SALT_ROUNDS);
  }
  throw new Error("bcrypt hashing engine unavailable");
}

/**
 * Dual-verification helper for coordinator passwords:
 * - If stored hash is bcrypt: verifies via bcrypt.compare()
 * - If stored hash is legacy 64-char SHA-256: verifies via constant-time SHA-256 comparison
 *   and flags needsRehash: true on successful match so caller can lazily upgrade to bcrypt.
 */
export async function verifyPassword(
  plainPassword: string,
  storedHash: string
): Promise<{ isValid: boolean; needsRehash: boolean }> {
  if (!plainPassword || !storedHash || typeof storedHash !== "string") {
    return { isValid: false, needsRehash: false };
  }

  const cleanPlain = plainPassword.trim();
  const cleanStored = storedHash.trim();

  // 1. Format A: Modern bcrypt ($2a$, $2b$, $2y$)
  if (isBcryptHash(cleanStored)) {
    try {
      const isValid = await bcryptLib.compare(cleanPlain, cleanStored);
      return { isValid: Boolean(isValid), needsRehash: false };
    } catch (e) {
      console.error("bcrypt compare error:", e);
      return { isValid: false, needsRehash: false };
    }
  }

  // 2. Format B: Legacy unsalted SHA-256 (64-character lowercase hex string)
  if (/^[0-9a-f]{64}$/i.test(cleanStored)) {
    const computedLegacy = await legacySha256(cleanPlain);
    
    // Constant-time comparison to prevent timing side-channels
    let diff = computedLegacy.length ^ cleanStored.length;
    for (let i = 0; i < computedLegacy.length && i < cleanStored.length; i++) {
      diff |= computedLegacy.charCodeAt(i) ^ cleanStored.charCodeAt(i);
    }
    const isValid = (diff === 0);
    return { isValid, needsRehash: isValid };
  }

  // Unknown or corrupted hash format
  return { isValid: false, needsRehash: false };
}
