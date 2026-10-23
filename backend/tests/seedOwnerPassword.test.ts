// The DB seed must never provision the owner account from a hard-coded
// password (audit C1: a plaintext owner password literal sat in
// prisma/seed.ts and in git history). The seed now reads the password from
// the OWNER_PASSWORD environment variable and fails closed — before any
// database write — when it is unset or empty.
//
// These tests pin that gate at requireOwnerPassword(), the pure helper
// main() calls first. Importing the seed module must not run the seed
// itself (main() only runs when the file is the process entrypoint), and
// the helper never touches the database: the dummy DATABASE_URL below only
// exists so the PrismaClient constructed at seed-module scope has a
// syntactically valid datasource. No query is ever issued by these tests.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://seed_test:seed_test@localhost:5432/seed_test?schema=public';

async function loadSeed() {
  return import('../prisma/seed');
}

describe('seed owner password gate (requireOwnerPassword)', () => {
  const originalOwnerPassword = process.env.OWNER_PASSWORD;

  afterEach(() => {
    if (originalOwnerPassword === undefined) {
      delete process.env.OWNER_PASSWORD;
    } else {
      process.env.OWNER_PASSWORD = originalOwnerPassword;
    }
  });

  test('unset OWNER_PASSWORD fails closed and names the variable', async () => {
    const { requireOwnerPassword } = await loadSeed();
    expect(() => requireOwnerPassword({})).toThrow(/OWNER_PASSWORD/);
  });

  test('empty OWNER_PASSWORD fails closed and names the variable', async () => {
    const { requireOwnerPassword } = await loadSeed();
    expect(() => requireOwnerPassword({ OWNER_PASSWORD: '' })).toThrow(/OWNER_PASSWORD/);
  });

  test('whitespace-only OWNER_PASSWORD fails closed', async () => {
    const { requireOwnerPassword } = await loadSeed();
    expect(() => requireOwnerPassword({ OWNER_PASSWORD: '   ' })).toThrow(/OWNER_PASSWORD/);
  });

  test('a set OWNER_PASSWORD is returned for hashing', async () => {
    const { requireOwnerPassword } = await loadSeed();
    expect(requireOwnerPassword({ OWNER_PASSWORD: 'test-only-owner-password' })).toBe(
      'test-only-owner-password'
    );
  });

  test('defaults to process.env', async () => {
    const { requireOwnerPassword } = await loadSeed();
    process.env.OWNER_PASSWORD = 'test-only-owner-password';
    expect(requireOwnerPassword()).toBe('test-only-owner-password');
  });
});
