import type { AxiosInstance } from 'axios';
import type { AuthSessionSource } from './sessionApi';

export const LOGOUT_DEADLINE_MS = 5000;
export interface LogoutResult { revocation: 'confirmed' | 'unconfirmed' | 'not-needed'; signedOutEpoch: number }

export function logoutNoticeApplies(auth: AuthSessionSource, result: LogoutResult): boolean {
  const state = auth.getState();
  return state.token === null && state.authEpoch === result.signedOutEpoch;
}

/** The supplied client deliberately has no current-session API interceptors. */
export async function logoutSession(auth: AuthSessionSource, revocationClient: AxiosInstance): Promise<LogoutResult> {
  const state = auth.getState();
  const capturedToken = state.token;
  state.logout(); // Clear memory, storage and private query bindings before any await.
  const signedOutEpoch = auth.getState().authEpoch;
  if (!capturedToken) return { revocation: 'not-needed', signedOutEpoch };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const revocation = await Promise.race([
      revocationClient.post('/auth/logout', {}, { headers: { Authorization: `Bearer ${capturedToken}` },
        signal: controller.signal, timeout: LOGOUT_DEADLINE_MS }).then(response =>
        response.data?.success === true && response.data?.revocationConfirmed === true ? 'confirmed' as const : 'unconfirmed' as const,
      () => 'unconfirmed' as const),
      new Promise<'unconfirmed'>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve('unconfirmed'); }, LOGOUT_DEADLINE_MS);
      }),
    ]);
    return { revocation, signedOutEpoch };
  } catch {
    return { revocation: 'unconfirmed', signedOutEpoch };
  } finally { if (timer) clearTimeout(timer); }
}
