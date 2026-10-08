export interface OrderState {
  status: string;
  filled_avg_price?: number | string | null;
  filled_qty?: number | string | null;
}

export interface OrderReader {
  getOrder(orderId: string): Promise<OrderState | null>;
}

export class OrderFillError extends Error {
  constructor(
    message: string,
    public readonly orderId: string,
    public readonly lastState: OrderState | null,
  ) {
    super(message);
    this.name = 'OrderFillError';
  }
}

/** Acceptance and partial execution are not confirmation of a complete fill. */
export async function confirmOrderFill(
  broker: OrderReader | null,
  orderId: string,
  maxAttempts = 8,
  intervalMs = 750,
): Promise<{ fillPrice: number; fillQty: number }> {
  if (!broker) throw new OrderFillError('Broker is required to confirm an order fill', orderId, null);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new OrderFillError('Invalid fill polling limits', orderId, null);
  }

  let lastState: OrderState | null = null;
  const terminalFailures = new Set(['rejected', 'canceled', 'expired', 'replaced', 'stopped']);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0 && intervalMs > 0) await new Promise(resolve => setTimeout(resolve, intervalMs));
    let order: OrderState | null;
    try {
      order = await broker.getOrder(orderId);
    } catch {
      // A transport failure cannot establish an order outcome; retry the same ID.
      continue;
    }
    if (!order) continue;
    lastState = order;
    if (terminalFailures.has(order.status)) {
      throw new OrderFillError(`Order ended as ${order.status}`, orderId, lastState);
    }
    if (order.status !== 'filled') continue;
    const fillPrice = Number(order.filled_avg_price);
    const fillQty = Number(order.filled_qty);
    if (!(Number.isFinite(fillPrice) && fillPrice > 0 && Number.isFinite(fillQty) && fillQty > 0)) {
      throw new OrderFillError('Broker reported a filled order without valid fill price/quantity', orderId, lastState);
    }
    return { fillPrice, fillQty };
  }
  throw new OrderFillError(`Order ${orderId} did not reach a confirmed fill within ${maxAttempts} attempts`, orderId, lastState);
}
