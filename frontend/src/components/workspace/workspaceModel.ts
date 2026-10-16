/** Presentation data only. Missing observations never imply an idle or busy worker. */
export type SpecialistState = 'unobserved' | 'waiting' | 'running' | 'voted' | 'error';
export interface SpecialistObservation {
  state: SpecialistState;
  receiptLabel?: string;
  evidence?: string;
  notes?: string[];
  history?: Array<{ text: string; receiptLabel: string }>;
}
export interface WorkspaceReview {
  id: string;
  asset: string;
  marketLabel: string;
  stageLabel: string;
  receiptLabel: string;
  specialists: Record<number, SpecialistObservation>;
  instrumentName?: string;
  listing?: string;
  priceLabel?: string;
  priceObservationLabel?: string;
  forecastLabel?: string;
  fundamentalsLabel?: string;
  decisionLabel?: string;
  issue?: { title: string; detail: string; specialistId: number };
  handoffs?: Array<{ from: number; to: number; receiptLabel: string }>;
}
export interface WorkspaceModel {
  sampleState: boolean;
  modeLabel: string;
  connectionLabel: string;
  connectionState: 'connected' | 'disconnected' | 'unknown';
  reviews: WorkspaceReview[];
  accountLabel: string;
  accountSummary: string;
  positionsLabel: string;
  faultsLabel: string;
  observedFaultCount: number | null;
  faultSummary: string;
}
export const EMPTY_WORKSPACE: WorkspaceModel = {
  sampleState: false, modeLabel: 'Mode unverified', connectionLabel: 'No session received', connectionState: 'unknown', reviews: [],
  accountLabel: 'Account unverified', accountSummary: 'Account data has not been received.',
  positionsLabel: 'Positions unverified', faultsLabel: 'Status unverified', observedFaultCount: null, faultSummary: 'No system status received.',
};
