/** A late response from an earlier sign-in cannot invalidate the current session. */
export function belongsToCurrentSession(authorization: unknown, token: string | null): boolean {
  return !!token && typeof authorization === 'string' && authorization === `Bearer ${token}`;
}
