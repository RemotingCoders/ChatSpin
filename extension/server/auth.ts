import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
const claimsSchema = z.object({
  channel_id: z.string().regex(/^\d+$/),
  exp: z.number().finite(),
  nbf: z.number().finite().optional(),
  opaque_user_id: z.string().min(2).max(100),
  role: z.enum(['viewer', 'moderator', 'broadcaster']),
  user_id: z.string().regex(/^\d+$/).optional(),
  is_unlinked: z.preprocess(
    (v) => (v === 'false' ? false : v === 'true' ? true : v),
    z.boolean().optional(),
  ),
});
export type ExtensionClaims = z.infer<typeof claimsSchema>;
export function verifyExtensionJWT(
  token: string,
  secrets: string[],
  channel: string | undefined,
  now = Date.now(),
): ExtensionClaims {
  if (token.length > 8192) throw Error('Invalid extension authorization');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[-_A-Za-z0-9]+$/.test(p)))
    throw Error('Invalid extension authorization');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  if (header.alg !== 'HS256' || header.crit || header.jku || header.jwk)
    throw Error('Invalid extension authorization');
  const supplied = Buffer.from(parts[2], 'base64url');
  let valid = false;
  for (const secret of secrets) {
    const key = Buffer.from(secret, 'base64');
    if (key.length < 32) continue;
    const signature = createHmac('sha256', key)
      .update(parts[0] + '.' + parts[1])
      .digest();
    if (supplied.length === signature.length && timingSafeEqual(supplied, signature)) valid = true;
  }
  if (!valid) throw Error('Invalid extension authorization');
  const claims = claimsSchema.parse(JSON.parse(Buffer.from(parts[1], 'base64url').toString()));
  if (
    (channel !== undefined && claims.channel_id !== channel) ||
    claims.exp <= now / 1000 ||
    (claims.nbf !== undefined && claims.nbf > now / 1000)
  )
    throw Error('Invalid extension authorization');
  if (!/^[UA]/.test(claims.opaque_user_id)) throw Error('Invalid extension authorization');
  return claims;
}
export function extensionController(claims: ExtensionClaims, moderators: string[]) {
  if (claims.role === 'broadcaster')
    return (
      claims.opaque_user_id === 'U' + claims.channel_id || claims.user_id === claims.channel_id
    );
  return (
    claims.role === 'moderator' &&
    !!claims.user_id &&
    !claims.is_unlinked &&
    moderators.includes(claims.user_id)
  );
}
export function linkedViewer(claims: ExtensionClaims) {
  return !claims.is_unlinked && claims.opaque_user_id.startsWith('U') ? claims.user_id : undefined;
}
