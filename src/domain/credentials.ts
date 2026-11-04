import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from './errors.js';

function encryptionKey(key: string | undefined): Buffer {
  const decoded = Buffer.from(key ?? '', 'base64');
  if (decoded.length !== 32)
    throw new AppError(503, 'Configure CREDENTIAL_ENCRYPTION_KEY com 32 bytes base64.');
  return decoded;
}
export function seal(value: string, key: string | undefined): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  cipher.setAAD(Buffer.from('creator-outreach:v1'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}
export function unseal(value: string, key: string | undefined): string {
  try {
    const [version, iv, tag, payload, extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !payload || extra) throw new Error();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(key),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from('creator-outreach:v1'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new AppError(
      503,
      'Credencial criptografada indisponível. Verifique a chave de criptografia.',
    );
  }
}
