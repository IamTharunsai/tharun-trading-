jest.mock('../src/utils/prisma', () => ({ prisma: {} }));
jest.mock('../src/trading/positionExits', () => ({ requestPositionExit: jest.fn() }));
import { closePosition } from '../src/trading/riskManager';
import { requestPositionExit } from '../src/trading/positionExits';

describe('manual exit wrapper', () => {
  it('passes durable position identity and reason, never a caller price', async () => {
    (requestPositionExit as jest.Mock).mockResolvedValue({ closed: true, pnl: 50, pnlPct: 5 });
    expect(await closePosition({ id: 'pos-1', asset: 'AAPL' }, 999999, 'manual_close')).toMatchObject({ closed: true, pnl: 50 });
    expect(requestPositionExit).toHaveBeenCalledWith('pos-1', 'manual_close');
  });
  it('returns pending broker state instead of claiming closure', async () => {
    (requestPositionExit as jest.Mock).mockResolvedValue({ closed: false, pending: true });
    expect(await closePosition({ id: 'pos-1', asset: 'AAPL' }, 105, 'manual_close')).toMatchObject({ closed: false, pending: true });
  });
});
