'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const PARAMETERS = { N: 16384, r: 8, p: 1 };

async function derive(password, salt, params = PARAMETERS) {
  return scrypt(password, salt, KEY_LENGTH, {
    ...params,
    maxmem: 64 * 1024 * 1024,
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await derive(String(password), salt);
  return `scrypt$${PARAMETERS.N}$${PARAMETERS.r}$${PARAMETERS.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  // Bound stored parameters before doing expensive work.
  if (!Number.isInteger(N) || N < 16384 || N > 32768 || (N & (N - 1)) !== 0) return false;
  if (!Number.isInteger(r) || r < 1 || r > 8 || !Number.isInteger(p) || p < 1 || p > 2) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltRaw, 'base64url');
    expected = Buffer.from(keyRaw, 'base64url');
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await derive(String(password), salt, { N, r, p });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword, PARAMETERS };
