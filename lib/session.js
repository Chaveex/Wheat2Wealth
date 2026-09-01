import crypto from 'crypto';

// A lightweight, dependency-free session token: base64url(payload) + HMAC
// signature, so it can be trusted as an httpOnly cookie without needing a
// separate sessions table. It proves "this cookie was issued by our server
// for this account", nothing more elaborate than that.
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

export function createSessionToken(payload) {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
