import { WorkspaceModel } from '../../src/components/workspace/workspaceModel';

/** Isolated comp-calibration data. This file is not imported by the app entry. */
export const workspaceFixture: WorkspaceModel = {
  sampleState: true, modeLabel: 'Paper mode', connectionLabel: 'Design fixture, not a live connection', connectionState: 'connected',
  accountLabel: 'Account (paper)', accountSummary: 'Sample paper equity  $25,000.00  ·  0 open positions',
  positionsLabel: 'No open positions', positionsCount: 0, faultsLabel: 'Data faults (1)', observedFaultCount: 1,
  faultSummary: 'Options Flow   Provider response invalid — no vote recorded',
  reviews: [{ id: 'fixture-review-nu', asset: 'NU', marketLabel: 'Stocks', stageLabel: 'opening arguments',
    receiptLabel: 'Updated 13:07:40 EDT', instrumentName: 'Nu Holdings Ltd.', listing: 'NYSE · Stocks',
    priceLabel: '$15.38', priceObservationLabel: 'observed 13:07:40 EDT', forecastLabel: '−1.89% · uncalibrated',
    fundamentalsLabel: 'Fundamentals unavailable', decisionLabel: 'Awaiting coordinator',
    issue: { title: 'Provider response invalid — no vote recorded', detail: 'The Options Flow provider returned an invalid response format for this request.', specialistId: 12 },
    handoffs: [{ from: 1, to: 2, receiptLabel: 'Sample path' }, { from: 2, to: 3, receiptLabel: 'Sample path' }],
    specialists: { ...Object.fromEntries(Array.from({ length: 14 }, (_, index) => [index + 1, { state: 'waiting' as const }])),
      1: { state: 'running', receiptLabel: '13:07:34', evidence: 'Breakout attempt below 20-day MA' },
      2: { state: 'running', receiptLabel: '13:07:40', evidence: 'Price $15.38 · observed 13:07:40', notes: ['Sample note for an isolated rendering test.'],
        history: [{ text: 'Sample source observation, not a provider response.', receiptLabel: '13:07:40' }] },
      12: { state: 'error', receiptLabel: '13:06:12' } } },
    { id: 'fixture-review-complete', asset: 'AAPL', marketLabel: 'Stocks', stageLabel: 'review complete', receiptLabel: 'Sample earlier review',
      specialists: {}, decisionLabel: 'Sample review complete' }],
};
