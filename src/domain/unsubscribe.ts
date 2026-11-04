import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';
import { contactEmailSchema } from './models.js';

// Sem expiração: um destinatário deve poder recusar contato mesmo meses depois.
export function unsubscribeToken(email: string, key: string): string {
  if (key.length < 32) throw new AppError(503, 'Descadastro público ainda não configurado.');
  const data = Buffer.from(contactEmailSchema.parse(email)).toString('base64url');
  return `${data}.${createHmac('sha256', key).update(data).digest('base64url')}`;
}
export function verifyUnsubscribeToken(token: string, key: string): string {
  if (key.length < 32) throw new AppError(503, 'Descadastro público ainda não configurado.');
  const [data, signature, extra] = token.split('.');
  if (!data || !signature || extra || token.length > 600)
    throw new AppError(400, 'Link de descadastro inválido.');
  const expected = createHmac('sha256', key).update(data).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw new AppError(400, 'Link de descadastro inválido.');
  return contactEmailSchema.parse(Buffer.from(data, 'base64url').toString('utf8'));
}
