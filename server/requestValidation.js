// Pulls the token out of an `Authorization: Bearer <token>` header.
export function parseBearerToken(header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}
