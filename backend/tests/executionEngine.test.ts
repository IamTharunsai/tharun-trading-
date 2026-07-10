import { confirmOrderFill } from '../src/trading/executionEngine';

// Regression coverage for the two bugs a code review caught in this exact
// logic: (1) trusting the first partial fill instead of waiting for the
// order's terminal 'filled' status, and (2) silently falling back to the
// stale pre-trade quote when an order never confirms within the poll
// window. Both were live production incidents before being fixed — see
// executionEngine.ts's comments on confirmOrderFill for the NVDA/SDOT
// incidents this guards against.

function mockClient(responses: any[]) {
  let call = 0;
  return {
    getOrder: jest.fn(() => Promise.resolve(responses[Math.min(call++, responses.length - 1)])),
  };
}

describe('confirmOrderFill', () => {
  it('returns the real fill price/qty once the order reaches filled status', async () => {
    const client = mockClient([{ status: 'filled', filled_avg_price: '206.92', filled_qty: '49.31' }]);
    const result = await confirmOrderFill(client, 'order-1', 5, 1);
    expect(result).toEqual({ fillPrice: 206.92, fillQty: 49.31 });
  });

  it('does NOT resolve on a partial fill even though filled_avg_price is already set', async () => {
    // Alpaca sets filled_avg_price as soon as ANY shares fill, while status
    // stays 'partially_filled' — resolving here would silently record a
    // partial quantity as the whole (closed) position.
    const client = mockClient([
      { status: 'partially_filled', filled_avg_price: '206.92', filled_qty: '10' },
      { status: 'partially_filled', filled_avg_price: '206.95', filled_qty: '25' },
      { status: 'filled', filled_avg_price: '207.01', filled_qty: '49.31' },
    ]);
    const result = await confirmOrderFill(client, 'order-1', 5, 1);
    expect(result).toEqual({ fillPrice: 207.01, fillQty: 49.31 });
    expect(client.getOrder).toHaveBeenCalledTimes(3);
  });

  it('throws on a rejected order instead of falling back to the quoted price', async () => {
    const client = mockClient([{ status: 'rejected' }]);
    await expect(confirmOrderFill(client, 'order-1', 5, 1)).rejects.toThrow('Order ended as rejected');
  });

  it('throws on canceled/expired the same way', async () => {
    const canceled = mockClient([{ status: 'canceled' }]);
    await expect(confirmOrderFill(canceled, 'o', 5, 1)).rejects.toThrow('Order ended as canceled');

    const expired = mockClient([{ status: 'expired' }]);
    await expect(confirmOrderFill(expired, 'o', 5, 1)).rejects.toThrow('Order ended as expired');
  });

  it('throws rather than using the stale quote if the order never confirms within the poll window', async () => {
    // Order stays in 'new'/'accepted' — not a terminal state, not filled.
    const client = mockClient([{ status: 'accepted' }]);
    await expect(confirmOrderFill(client, 'order-1', 3, 1)).rejects.toThrow(
      'did not reach a confirmed fill'
    );
    expect(client.getOrder).toHaveBeenCalledTimes(3);
  });

  it('treats a network blip on getOrder as "not yet confirmed", not a hard failure, and keeps polling', async () => {
    let call = 0;
    const client = {
      getOrder: jest.fn(() => {
        call++;
        if (call === 1) return Promise.reject(new Error('network blip'));
        return Promise.resolve({ status: 'filled', filled_avg_price: '100.00', filled_qty: '5' });
      }),
    };
    const result = await confirmOrderFill(client, 'order-1', 5, 1);
    expect(result).toEqual({ fillPrice: 100, fillQty: 5 });
  });
});
