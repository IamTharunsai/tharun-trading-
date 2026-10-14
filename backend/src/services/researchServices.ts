/** These services produce lower-trust research evidence. They cannot authorize
 * orders, change risk settings or provide instructions to the trading council. */
export const RESEARCH_SERVICES = ['graphify', 'hermes', 'mirofish'] as const;
export type ResearchService = typeof RESEARCH_SERVICES[number];

// Kept equal to integrations/research/pins.json by the contract test. Compiled
// constants avoid loading an editable runtime file or relying on process cwd.
export const RESEARCH_COMMITS: Record<ResearchService, string> = {
  graphify: '7536dc0665dba4adacca1a323c84fedb217ddc5d',
  hermes: 'ea45ec3936720abef431439152e75b2fc7dd4039',
  mirofish: '7657031ac01184afe2cb220f5ee3545573b5e843',
};
const RESEARCH_TIMEOUTS: Record<ResearchService, number> = { graphify: 30000, hermes: 80000, mirofish: 490000 };
const MAX_RESPONSE_BYTES = 262144;
export const CODE_CORPUS_COMMIT = '3280a7cafec5ecb9c32f0d1d5bb7af0419d6b9bf';
const BLOCKERS = new Set(['NVIDIA_API_KEY', 'ZEP_API_KEY', 'verified_code_graph', 'bounded_scenario_adapter']);
const CAPABILITIES = new Set(['code_graph_query', 'evidence_research_without_tools', 'bounded_scenario_simulation']);

export type ResearchStatus = {
  service: ResearchService; sourceCommit: string; configured: boolean;
  state: 'missing' | 'unreachable' | 'blocked' | 'ready'; ready: boolean;
  blockedBy: string[]; capabilities: string[]; tradingAuthority: false;
  codeSnapshot?: { commit: string; nodes: number; edges: number; sha256: string };
};
export class ResearchServiceError extends Error {
  constructor(public readonly code: 'invalid_input' | 'missing_configuration' | 'service_unavailable' | 'service_busy' | 'service_not_ready', public readonly status: number) {
    super(code); this.name = 'ResearchServiceError';
  }
}
export function isResearchService(value: string): value is ResearchService {
  return RESEARCH_SERVICES.some(service => service === value);
}
export function validateResearchInput(value: unknown): { question: string; evidence: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ResearchServiceError('invalid_input', 422);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'evidence,question' ||
    typeof input.question !== 'string' || !input.question.trim() || input.question.length > 1000 ||
    typeof input.evidence !== 'string' || input.evidence.length > 16000) throw new ResearchServiceError('invalid_input', 422);
  const body = { question: input.question, evidence: input.evidence };
  // The service boundary also limits UTF-8 JSON bytes, independent of characters.
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 32768) throw new ResearchServiceError('invalid_input', 422);
  return body;
}
function configuration(service: ResearchService): { origin: string; key: string } | null {
  const prefix = service.toUpperCase();
  const value = process.env[`${prefix}_SERVICE_URL`]?.trim();
  const key = process.env[`${prefix}_SERVICE_KEY`]?.trim();
  if (!value || !key || key.length < 32 || key.length > 512 || /[\r\n\s]/.test(key)) return null;
  try {
    const url = new URL(value);
    // Deployment-owned Railway origins only; input cannot choose a host or path.
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.up\.railway\.app$/.test(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') return null;
    return { origin: url.origin, key };
  } catch { return null; }
}
async function request(service: ResearchService, path: '/v1/status' | '/v1/research', body?: { question: string; evidence: string }): Promise<Record<string, unknown>> {
  const config = configuration(service);
  if (!config) throw new ResearchServiceError('missing_configuration', 503);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Awaited<ReturnType<typeof fetch>> | undefined;
  let timedOut = false;
  let rejectTimeout!: (error: Error) => void;
  const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
  const deadline = setTimeout(() => {
    timedOut = true; controller.abort();
    if (reader) void reader.cancel().catch(() => undefined);
    rejectTimeout(new Error('deadline'));
  }, body === undefined ? 10000 : RESEARCH_TIMEOUTS[service]);
  try {
    response = await Promise.race([fetch(new URL(path, config.origin), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).then(value => {
      if (timedOut) { void value.body?.cancel().catch(() => undefined); throw new Error('deadline'); }
      return value;
    }), timeout]);
    if (response.status === 429) throw new ResearchServiceError('service_busy', 429);
    if (response.status === 503) throw new ResearchServiceError('service_not_ready', 503);
    if (!response.ok || !response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('response');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (timedOut) throw new Error('deadline');
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('size');
      chunks.push(chunk.value);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw.includes(config.key)) throw new Error('credential_echo');
    const result: unknown = JSON.parse(raw);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('shape');
    const data = result as Record<string, unknown>;
    if (data.service !== service || data.sourceCommit !== RESEARCH_COMMITS[service]) throw new Error('identity');
    return data;
  } catch (error) {
    if (error instanceof ResearchServiceError) throw error;
    // Provider errors, response bodies, hosts and credentials never reach clients.
    throw new ResearchServiceError('service_unavailable', 502);
  } finally {
    clearTimeout(deadline); controller.abort();
    if (reader) void reader.cancel().catch(() => undefined);
    else if (response?.body) void response.body.cancel().catch(() => undefined);
  }
}
function stringList(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value) || value.length > 8 || value.some(item => typeof item !== 'string' || !allowed.has(item))) throw new ResearchServiceError('service_unavailable', 502);
  return [...new Set(value as string[])];
}
export async function getResearchServiceStatus(service: ResearchService): Promise<ResearchStatus> {
  const base = { service, sourceCommit: RESEARCH_COMMITS[service], configured: Boolean(configuration(service)), ready: false,
    blockedBy: [] as string[], capabilities: [] as string[], tradingAuthority: false as const };
  if (!base.configured) return { ...base, state: 'missing' };
  try {
    const data = await request(service, '/v1/status');
    if (typeof data.ready !== 'boolean' || data.tradingAuthority !== false) throw new Error('authority');
    const blockedBy = stringList(data.blockedBy, BLOCKERS);
    const capabilities = stringList(data.capabilities, CAPABILITIES);
    if ((data.ready && blockedBy.length > 0) || (!data.ready && blockedBy.length === 0)) throw new Error('readiness');
    let codeSnapshot: ResearchStatus['codeSnapshot'];
    if (service === 'graphify' && data.ready) {
      if (data.corpusCommit !== CODE_CORPUS_COMMIT || !Number.isSafeInteger(data.nodes) || !Number.isSafeInteger(data.edges) ||
        (data.nodes as number) < 1 || (data.nodes as number) > 200000 || (data.edges as number) < 1 || typeof data.artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.artifactSha256)) throw new Error('corpus');
      codeSnapshot = { commit: CODE_CORPUS_COMMIT, nodes: data.nodes as number, edges: data.edges as number, sha256: data.artifactSha256 };
    }
    return { ...base, state: data.ready ? 'ready' : 'blocked', ready: data.ready, blockedBy, capabilities, ...(codeSnapshot ? { codeSnapshot } : {}) };
  } catch { return { ...base, state: 'unreachable' }; }
}
export async function getResearchServicesStatus(): Promise<{ services: ResearchStatus[]; observedAt: string }> {
  return { services: await Promise.all(RESEARCH_SERVICES.map(getResearchServiceStatus)), observedAt: new Date().toISOString() };
}
export async function runResearchService(service: ResearchService, input: unknown): Promise<{
  service: ResearchService; sourceCommit: string; evidenceOnly: true; tradingAuthority: false; text: string; observedAt: string; corpusCommit?: string;
}> {
  const data = await request(service, '/v1/research', validateResearchInput(input));
  if (data.evidenceOnly !== true || (data.tradingAuthority !== undefined && data.tradingAuthority !== false) || typeof data.text !== 'string' || !data.text.trim() || data.text.length > 16000 ||
    typeof data.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(data.observedAt) || !Number.isFinite(Date.parse(data.observedAt))) {
    throw new ResearchServiceError('service_unavailable', 502);
  }
  if (service === 'hermes' && (data.completed !== true || data.partial === true)) throw new ResearchServiceError('service_unavailable', 502);
  if (service === 'mirofish' && (data.completed !== true || data.calibratedForecast !== false)) throw new ResearchServiceError('service_unavailable', 502);
  if (service === 'graphify' && data.corpusCommit !== CODE_CORPUS_COMMIT) throw new ResearchServiceError('service_unavailable', 502);
  return { service, sourceCommit: RESEARCH_COMMITS[service], evidenceOnly: true, tradingAuthority: false, text: data.text, observedAt: data.observedAt,
    ...(service === 'graphify' ? { corpusCommit: CODE_CORPUS_COMMIT } : {}) };
}
