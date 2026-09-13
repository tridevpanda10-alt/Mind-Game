// Auth & crypto: scrypt password hashing, opaque session tokens, PBKDF2-free
// (Node built-ins only). Session tokens are random 32-byte values; only their
// SHA-256 hash is stored, so a DB leak cannot resurrect sessions.

import { scryptSync, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function newPlayerId() {
  return 'p_' + randomBytes(9).toString('base64url'); // stable, opaque, non-enumerable
}

export function newMatchId() {
  return 'm_' + randomBytes(9).toString('base64url');
}
