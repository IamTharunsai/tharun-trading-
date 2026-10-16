import axios, { InternalAxiosRequestConfig } from 'axios';
import { belongsToCurrentSession } from '../utils/sessionResponse';

export interface AuthSessionState { token: string | null; authEpoch: number; logout: () => void }
export interface AuthSessionSource { getState: () => AuthSessionState }
interface SessionConfig extends InternalAxiosRequestConfig { sessionEpoch?: number }

/** Bind credentials to the calling session before Axios schedules dispatch. */
export function createSessionApi(auth: AuthSessionSource, baseURL: string) {
  const api = axios.create({ baseURL, timeout: 15000 });
  // Axios 1.6 supports synchronous interceptors; response guards also reject
  // completed work from a retired session, including re-login with the same token.
  // https://github.com/axios/axios/tree/v1.6.7#interceptors
  api.interceptors.request.use(config => {
    const state = auth.getState();
    (config as SessionConfig).sessionEpoch = state.authEpoch;
    if (state.token) config.headers.set('Authorization', `Bearer ${state.token}`);
    else config.headers.delete('Authorization');
    return config;
  }, undefined, { synchronous: true });
  api.interceptors.response.use(response => {
    if ((response.config as SessionConfig).sessionEpoch !== auth.getState().authEpoch) {
      throw new axios.CanceledError('Authentication session changed');
    }
    return response;
  }, error => {
    const config = error.config as SessionConfig | undefined;
    const state = auth.getState();
    if (config && config.sessionEpoch !== state.authEpoch) return Promise.reject(new axios.CanceledError('Authentication session changed'));
    const authorization = config?.headers?.get('Authorization');
    if (error.response?.status === 401 && belongsToCurrentSession(authorization, state.token)) state.logout();
    // Temporary 503 authority failures preserve the current sign-in for retry.
    return Promise.reject(error);
  });
  return api;
}
