// MOCKED — in-memory, data lost on container sleep (per AI Studio web migration guidelines)
const store = new Map<string, string>();

export const redis: any = {
  status: 'ready',
  get: async (k: string): Promise<string | null> => store.get(k) ?? null,
  set: async (k: string, v: string): Promise<'OK'> => {
    store.set(k, String(v));
    return 'OK';
  },
  setex: async (k: string, _ttl: number, v: string): Promise<'OK'> => {
    store.set(k, String(v));
    return 'OK';
  },
  del: async (k: string): Promise<number> => (store.delete(k) ? 1 : 0),
  mget: async (keys: string[]): Promise<(string | null)[]> => keys.map(k => store.get(k) ?? null),
  incr: async (k: string): Promise<number> => {
    const val = (parseInt(store.get(k) || '0', 10) || 0) + 1;
    store.set(k, String(val));
    return val;
  },
  on: (_evt: string, _cb: Function): any => redis,
  connect: async (): Promise<void> => {},
  disconnect: async (): Promise<void> => {},
  quit: async (): Promise<'OK'> => 'OK',
};
