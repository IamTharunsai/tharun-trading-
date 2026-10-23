// The kill switch must fail CLOSED. Before this fix, a database error while
// loading the persisted state left the in-memory flag false (trading resumed
// after a restart whose emergency stop could not be read), and a failed
// persist was only logged, so the runtime state silently diverged from the
// persisted one. Every trading path consults isKillSwitchActive(), so these
// tests pin the contract at that single chokepoint.
const mockFindFirst = jest.fn();
const mockUpsert = jest.fn();
jest.mock('../src/utils/prisma', () => ({ prisma: {
  settings: { findFirst: mockFindFirst, upsert: mockUpsert },
} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockFindFirst.mockResolvedValue({ killSwitchActive: false });
  mockUpsert.mockResolvedValue({});
});

async function loadOrchestrator() {
  return import('../src/agents/orchestrator');
}

test('load: a persisted active state halts trading', async () => {
  mockFindFirst.mockResolvedValue({ killSwitchActive: true });
  const orch = await loadOrchestrator();
  await expect(orch.loadKillSwitchState()).resolves.toBe(true);
  expect(orch.isKillSwitchActive()).toBe(true);
});

test('load: a persisted inactive state leaves trading open', async () => {
  const orch = await loadOrchestrator();
  await expect(orch.loadKillSwitchState()).resolves.toBe(false);
  expect(orch.isKillSwitchActive()).toBe(false);
});

test('load: no settings row yet (first boot) leaves trading open', async () => {
  mockFindFirst.mockResolvedValue(null);
  const orch = await loadOrchestrator();
  await expect(orch.loadKillSwitchState()).resolves.toBe(false);
  expect(orch.isKillSwitchActive()).toBe(false);
});

test('load: a database error fails CLOSED — trading is refused', async () => {
  mockFindFirst.mockRejectedValue(new Error('connection refused'));
  const orch = await loadOrchestrator();
  await expect(orch.loadKillSwitchState()).resolves.toBe(true);
  expect(orch.isKillSwitchActive()).toBe(true);
});

test('persist: a failed deactivation persist leaves the switch treated as engaged', async () => {
  const orch = await loadOrchestrator();
  await orch.loadKillSwitchState();
  expect(orch.isKillSwitchActive()).toBe(false);
  mockUpsert.mockRejectedValue(new Error('disk full'));
  orch.deactivateKillSwitch();
  await flush();
  expect(orch.isKillSwitchActive()).toBe(true);
});

test('persist: the switch recovers once a later persist succeeds', async () => {
  const orch = await loadOrchestrator();
  await orch.loadKillSwitchState();
  mockUpsert.mockRejectedValue(new Error('disk full'));
  orch.deactivateKillSwitch();
  await flush();
  expect(orch.isKillSwitchActive()).toBe(true);
  mockUpsert.mockResolvedValue({});
  orch.deactivateKillSwitch();
  await flush();
  expect(orch.isKillSwitchActive()).toBe(false);
});

test('normal paths: activate halts and a successful deactivate resumes', async () => {
  const orch = await loadOrchestrator();
  await orch.loadKillSwitchState();
  orch.activateKillSwitch();
  expect(orch.isKillSwitchActive()).toBe(true);
  orch.deactivateKillSwitch();
  await flush();
  expect(orch.isKillSwitchActive()).toBe(false);
});
