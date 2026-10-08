jest.mock('../src/utils/prisma', () => ({ prisma: { prediction: { findUnique: jest.fn() }, trade: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() } } }));
import { prisma } from '../src/utils/prisma';
import { recordPredictionSimulation, listPredictionSimulations } from '../src/routes/predictionSimulation';
async function request(body: any) {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await recordPredictionSimulation({ body } as any, res);
  return res;
}
beforeEach(() => { jest.clearAllMocks(); (prisma.prediction.findUnique as jest.Mock).mockResolvedValue({ id: 'fixture', yesPrice: 0.4, noPrice: 0.6 }); (prisma.trade.create as jest.Mock).mockResolvedValue({ id: 'simulation' }); });
test.each([undefined, {}, { predictionId: 'fixture', outcome: 'INVALID', amount: 10 }, { predictionId: 'fixture', amount: '10' }, { predictionId: 'fixture', amount: Infinity }, { predictionId: 'fixture', amount: -1 }])('invalid request is refused before storage %j', async body => {
  expect((await request(body)).status).toHaveBeenCalledWith(400);
  expect(prisma.trade.create).not.toHaveBeenCalled();
});
test('NO simulation uses NO price and is never an open broker fill', async () => {
  const res = await request({ predictionId: 'fixture', outcome: 'NO', amount: 12 });
  expect(prisma.trade.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'LOCAL_SIMULATION', entryPrice: 0.6, quantity: 20, metadata: expect.objectContaining({ brokerSubmitted: false }) }) }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ executionMode: 'LOCAL_SIMULATION', brokerSubmitted: false }));
});
test('storage failure is not reported as success or exposed', async () => {
  (prisma.trade.create as jest.Mock).mockRejectedValue(new Error('fixture-private-db-details'));
  const res = await request({ predictionId: 'fixture', amount: 10 });
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'Simulation could not be recorded' });
});
test('ledger reads only simulations across both market labels with bounded pages', async () => {
  (prisma.trade.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.trade.count as jest.Mock).mockResolvedValue(0);
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await listPredictionSimulations({ query: { page: '2' } } as any, res);
  expect(prisma.trade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { asset: 'POLYMARKET', status: 'LOCAL_SIMULATION' }, skip: 50, take: 50 }));
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ simulations: [], brokerSubmitted: false }));
});
test('invalid pagination is refused before ledger access', async () => {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await listPredictionSimulations({ query: { page: '-1' } } as any, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(prisma.trade.findMany).not.toHaveBeenCalled();
});