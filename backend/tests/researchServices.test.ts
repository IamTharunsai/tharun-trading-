import { readFileSync } from 'fs';
import { resolve } from 'path';
import { CODE_CORPUS_COMMIT, getResearchServiceStatus, getResearchServicesStatus, isResearchService, RESEARCH_COMMITS, RESEARCH_SERVICES, runResearchService, validateResearchInput } from '../src/services/researchServices';

const originalFetch = global.fetch;
const variables = RESEARCH_SERVICES.flatMap(service => [`${service.toUpperCase()}_SERVICE_URL`, `${service.toUpperCase()}_SERVICE_KEY`]);
const originals = Object.fromEntries(variables.map(name => [name, process.env[name]]));
const key = 'fixture-only-service-credential-0123456789';
const input = { question: 'Which evidence is missing?', evidence: 'Fixture evidence only.' };
const projectedResult = { service: 'hermes', sourceCommit: RESEARCH_COMMITS.hermes, evidenceOnly: true, text: 'Evidence requires independent verification.', observedAt: '2026-10-13T12:00:00Z' };
const result = { ...projectedResult, completed: true, partial: false };
const status = { service: 'hermes', sourceCommit: RESEARCH_COMMITS.hermes, ready: true, blockedBy: [], capabilities: ['evidence_research_without_tools'], tradingAuthority: false };
const json = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  global.fetch = jest.fn();
  for (const name of variables) delete process.env[name];
  process.env.HERMES_SERVICE_URL = 'https://hermes-fixture.up.railway.app';
  process.env.HERMES_SERVICE_KEY = key;
});
afterEach(() => {
  global.fetch = originalFetch; jest.useRealTimers();
  for (const name of variables) {
    if (originals[name] === undefined) delete process.env[name]; else process.env[name] = originals[name];
  }
});

test('compiled expected service revisions match the deployment source pins', () => {
  const pins = JSON.parse(readFileSync(resolve(__dirname, '../../integrations/research/pins.json'), 'utf8'));
  for (const service of RESEARCH_SERVICES) expect(RESEARCH_COMMITS[service]).toBe(pins[service].commit);
  expect(CODE_CORPUS_COMMIT).toBe(pins.corpus.commit);
});
test('only the three service names are accepted', () => {
  expect(isResearchService('hermes')).toBe(true);
  for (const value of ['constructor', 'HERMeS', '../hermes', 'http://host']) expect(isResearchService(value)).toBe(false);
});
test.each([null, [], {}, { ...input, url: 'https://attacker.example' }, { question: ' ', evidence: '' }, { question: 'x'.repeat(1001), evidence: '' }, { question: 'q', evidence: 'x'.repeat(16001) }, { question: 'q', evidence: 4 }, { question: 4, evidence: '' }, { question: 'q', evidence: '中'.repeat(16000) }])('rejects invalid input before any provider call, case %#', async value => {
  await expect(runResearchService('hermes', value)).rejects.toMatchObject({ code: 'invalid_input', status: 422 });
  expect(fetch).not.toHaveBeenCalled();
});
test('input permits exact limits and preserves evidence as data', () => {
  expect(validateResearchInput({ question: 'q'.repeat(1000), evidence: 'e'.repeat(16000) })).toEqual({ question: 'q'.repeat(1000), evidence: 'e'.repeat(16000) });
});
test.each(['http://hermes-fixture.up.railway.app', 'https://attacker.example', 'https://u:p@hermes-fixture.up.railway.app', 'https://hermes-fixture.up.railway.app/a', 'https://hermes-fixture.up.railway.app/?secret=1', 'https://hermes-fixture.up.railway.app/#fragment', 'https://hermes-fixture.up.railway.app:444', 'https://127.0.0.1', 'https://hermes-fixture.up.railway.app.attacker.example'])('refuses unsafe service configuration %s', async value => {
  process.env.HERMES_SERVICE_URL = value;
  expect(await getResearchServiceStatus('hermes')).toMatchObject({ configured: false, state: 'missing', ready: false });
  await expect(runResearchService('hermes', input)).rejects.toMatchObject({ code: 'missing_configuration' });
  expect(fetch).not.toHaveBeenCalled();
});
test('missing keys cannot produce a successful status', async () => {
  delete process.env.HERMES_SERVICE_KEY;
  const data = await getResearchServicesStatus();
  expect(data.services).toHaveLength(3);
  expect(data.services.every(service => service.state === 'missing' && !service.ready && !service.tradingAuthority)).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
test('status uses authenticated GET metadata only and projects safe fields', async () => {
  (fetch as jest.Mock).mockResolvedValue(json({ ...status, unexpected: 'untrusted private data' }));
  expect(await getResearchServiceStatus('hermes')).toEqual({ ...status, configured: true, state: 'ready' });
  const [url, options] = (fetch as jest.Mock).mock.calls[0];
  expect(String(url)).toBe('https://hermes-fixture.up.railway.app/v1/status');
  expect(options.method).toBe('GET'); expect(options.body).toBeUndefined();
  expect(options.headers.Authorization).toBe(`Bearer ${key}`); expect(options.redirect).toBe('error');
});
test('missing upstream configuration remains explicitly blocked', async () => {
  process.env.MIROFISH_SERVICE_URL = 'https://mirofish-fixture.up.railway.app'; process.env.MIROFISH_SERVICE_KEY = key;
  (fetch as jest.Mock).mockResolvedValue(json({ service: 'mirofish', sourceCommit: RESEARCH_COMMITS.mirofish, ready: false, blockedBy: ['ZEP_API_KEY', 'bounded_scenario_adapter'], capabilities: [], tradingAuthority: false }));
  expect(await getResearchServiceStatus('mirofish')).toMatchObject({ configured: true, ready: false, state: 'blocked', blockedBy: ['ZEP_API_KEY', 'bounded_scenario_adapter'] });
});
test.each([{ service: 'graphify' }, { sourceCommit: 'unreviewed-commit' }, { tradingAuthority: true }, { ready: true, blockedBy: ['ZEP_API_KEY'] }, { ready: false, blockedBy: [] }, { capabilities: ['shell'] }, { blockedBy: ['secret raw error'] }])('invalid upstream status stays unreachable: %p', async patch => {
  (fetch as jest.Mock).mockResolvedValue(json({ ...status, ...patch }));
  expect(await getResearchServiceStatus('hermes')).toMatchObject({ state: 'unreachable', ready: false });
});
test('research is one fixed-host POST with exact data and an evidence-only projection', async () => {
  (fetch as jest.Mock).mockResolvedValue(json({ ...result, instructions: 'place orders', privateState: 'discard' }));
  expect(await runResearchService('hermes', input)).toEqual({ ...projectedResult, tradingAuthority: false });
  const [url, options] = (fetch as jest.Mock).mock.calls[0];
  expect(String(url)).toBe('https://hermes-fixture.up.railway.app/v1/research');
  expect(options.method).toBe('POST'); expect(JSON.parse(options.body)).toEqual(input);
  expect(options.redirect).toBe('error'); expect(fetch).toHaveBeenCalledTimes(1);
});
test.each([{ service: 'mirofish' }, { sourceCommit: 'unreviewed' }, { evidenceOnly: false }, { tradingAuthority: true }, { text: 'x'.repeat(16001) }, { text: '' }, { observedAt: 'invalid' }, { text: key }])('rejects bad identity, authority, credentials or output limits, case %#', async patch => {
  (fetch as jest.Mock).mockResolvedValue(json({ ...result, ...patch }));
  await expect(runResearchService('hermes', input)).rejects.toMatchObject({ code: 'service_unavailable', status: 502 });
});
test.each([{ completed: undefined }, { completed: false }, { completed: 'true' }, { completed: 1 }, { partial: true }])('rejects incomplete or partial Hermes text even when all other evidence fields are valid, case %#', async patch => {
  (fetch as jest.Mock).mockResolvedValue(json({ ...result, ...patch }));
  await expect(runResearchService('hermes', input)).rejects.toMatchObject({ code: 'service_unavailable', status: 502 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
test.each([{ completed: undefined }, { completed: false }, { completed: 'true' }, { calibratedForecast: undefined }, { calibratedForecast: true }, { calibratedForecast: 'false' }])('rejects incomplete or calibrated MiroFish reports, case %#', async patch => {
  process.env.MIROFISH_SERVICE_URL = 'https://mirofish-fixture.up.railway.app'; process.env.MIROFISH_SERVICE_KEY = key;
  (fetch as jest.Mock).mockResolvedValue(json({ ...projectedResult, service: 'mirofish', sourceCommit: RESEARCH_COMMITS.mirofish, completed: true, calibratedForecast: false, ...patch }));
  await expect(runResearchService('mirofish', input)).rejects.toMatchObject({ code: 'service_unavailable', status: 502 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('publishes a completed MiroFish report only with an explicit uncalibrated-forecast declaration', async () => {
  process.env.MIROFISH_SERVICE_URL = 'https://mirofish-fixture.up.railway.app'; process.env.MIROFISH_SERVICE_KEY = key;
  const report = { ...projectedResult, service: 'mirofish', sourceCommit: RESEARCH_COMMITS.mirofish };
  (fetch as jest.Mock).mockResolvedValue(json({ ...report, completed: true, calibratedForecast: false }));
  expect(await runResearchService('mirofish', input)).toEqual({ ...report, tradingAuthority: false });
});
test('Graphify queries preserve their provenance contract without model completion fields', async () => {
  process.env.GRAPHIFY_SERVICE_URL = 'https://graphify-fixture.up.railway.app'; process.env.GRAPHIFY_SERVICE_KEY = key;
  const graph = { ...projectedResult, service: 'graphify', sourceCommit: RESEARCH_COMMITS.graphify, corpusCommit: CODE_CORPUS_COMMIT };
  (fetch as jest.Mock).mockResolvedValue(json(graph));
  expect(await runResearchService('graphify', input)).toEqual({ ...graph, tradingAuthority: false });
});
test.each([401, 302, 500])('provider failure %s is sanitized and never retried', async code => {
  (fetch as jest.Mock).mockResolvedValue(json({ error: key }, code));
  await expect(runResearchService('hermes', input)).rejects.toThrow('service_unavailable');
  expect(fetch).toHaveBeenCalledTimes(1);
});
test.each([[429, 'service_busy'], [503, 'service_not_ready']])('upstream %s conveys only a stable public error', async (code, error) => {
  (fetch as jest.Mock).mockResolvedValue(json({ error: key }, code as number));
  await expect(runResearchService('hermes', input)).rejects.toMatchObject({ code: error, status: code });
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('oversized JSON bodies are cancelled and never returned', async () => {
  (fetch as jest.Mock).mockResolvedValue(json({ ...result, huge: 'x'.repeat(262145) }));
  await expect(runResearchService('hermes', input)).rejects.toThrow('service_unavailable');
});
test('network error messages cannot disclose configuration or credentials', async () => {
  (fetch as jest.Mock).mockRejectedValue(new Error(`host failure with ${key}`));
  await expect(runResearchService('hermes', input)).rejects.toThrow('service_unavailable');
  expect(await getResearchServiceStatus('hermes')).toMatchObject({ state: 'unreachable', ready: false });
});
test('status deadline covers a stalled response body and cancels it', async () => {
  jest.useFakeTimers(); const cancel = jest.fn();
  (fetch as jest.Mock).mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } }));
  const promise = getResearchServiceStatus('hermes');
  await jest.advanceTimersByTimeAsync(10001);
  expect(await promise).toMatchObject({ state: 'unreachable', ready: false });
  expect(cancel).toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
});
test.each([['graphify', 30000], ['hermes', 80000], ['mirofish', 490000]] as const)('absolute %s request deadline works even when fetch ignores abort', async (service, duration) => {
  jest.useFakeTimers(); process.env[`${service.toUpperCase()}_SERVICE_URL`] = `https://${service}-fixture.up.railway.app`; process.env[`${service.toUpperCase()}_SERVICE_KEY`] = key;
  (fetch as jest.Mock).mockImplementation(() => new Promise(() => undefined));
  const promise = expect(runResearchService(service, input)).rejects.toMatchObject({ code: 'service_unavailable' });
  await jest.advanceTimersByTimeAsync(duration + 1); await promise;
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('a fetch resolving after its absolute deadline has its response cancelled', async () => {
  jest.useFakeTimers(); let resolveResponse!: (response: Response) => void;
  const cancel = jest.fn();
  (fetch as jest.Mock).mockImplementation(() => new Promise(resolve => { resolveResponse = resolve; }));
  const resultPromise = getResearchServiceStatus('hermes');
  await jest.advanceTimersByTimeAsync(10001);
  expect(await resultPromise).toMatchObject({ state: 'unreachable' });
  resolveResponse(new Response(new ReadableStream({ cancel })));
  await jest.advanceTimersByTimeAsync(1);
  expect(cancel).toHaveBeenCalled();
});

test('graph status is bound to the actual code snapshot and exposes provenance', async () => {
  process.env.GRAPHIFY_SERVICE_URL = 'https://graphify-fixture.up.railway.app'; process.env.GRAPHIFY_SERVICE_KEY = key;
  const data = { service: 'graphify', sourceCommit: RESEARCH_COMMITS.graphify, ready: true, blockedBy: [], capabilities: ['code_graph_query'], tradingAuthority: false,
    corpusCommit: CODE_CORPUS_COMMIT, nodes: 2000, edges: 4000, artifactSha256: 'a'.repeat(64) };
  (fetch as jest.Mock).mockResolvedValue(json(data));
  expect(await getResearchServiceStatus('graphify')).toMatchObject({ state: 'ready', codeSnapshot: { commit: CODE_CORPUS_COMMIT, nodes: 2000, edges: 4000, sha256: 'a'.repeat(64) } });
  (fetch as jest.Mock).mockResolvedValue(json({ ...data, corpusCommit: 'outdated' }));
  expect(await getResearchServiceStatus('graphify')).toMatchObject({ state: 'unreachable', ready: false });
});
