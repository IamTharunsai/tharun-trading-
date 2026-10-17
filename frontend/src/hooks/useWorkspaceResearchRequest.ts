import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useStore } from '../store';
import { WorkspaceModel } from '../components/workspace/workspaceModel';
import { ResearchNotice } from '../components/workspace/WorkspaceReadbackCoverage';

/** An HTTP acknowledgment has no debate ID and is never joined to observations by asset. */
export function useWorkspaceResearchRequest(model: WorkspaceModel, refresh: () => Promise<void>, readbackFailed: boolean) {
  const token = useStore(state => state.token), authEpoch = useStore(state => state.authEpoch);
  const pending = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState<(ResearchNotice & { epoch: number }) | undefined>();
  useEffect(() => {
    setNotice(undefined);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [token, authEpoch]);
  useEffect(() => { if (readbackFailed) { pending.current?.abort(); pending.current = null; setNotice(undefined); } }, [readbackFailed]);
  const request = async (reviewId: string) => {
    const review = model.reviews.find(item => item.id === reviewId), captured = useStore.getState();
    if (!review?.market || !captured.token || captured.authEpoch !== authEpoch || captured.token !== token || pending.current || readbackFailed) return;
    const controller = new AbortController(); pending.current = controller;
    const current = () => !controller.signal.aborted && useStore.getState().authEpoch === captured.authEpoch
      && useStore.getState().token === captured.token;
    setNotice({ epoch: captured.authEpoch, phase: 'pending', message: 'Sending research request only. Session start and execution are not confirmed.' });
    try {
      await api.post('/agents/trigger-debate', { asset: review.asset, market: review.market }, { signal: controller.signal, timeout: 10_000 });
      if (!current()) return;
      setNotice({ epoch: captured.authEpoch, phase: 'acknowledged', message: 'Research request acknowledged. No session identity was returned; session start, completion and execution remain unconfirmed. Check observed receipts separately.' });
      void refresh();
    } catch (error) {
      if (!current()) return;
      const status = (error as { response?: { status?: number } })?.response?.status;
      setNotice({ epoch: captured.authEpoch, phase: status ? 'error' : 'unconfirmed', message: status === 403
        ? 'Owner authorization was not granted for this research request.' : status
          ? 'The research request was not acknowledged. Its outcome is unconfirmed; no automatic retry was sent.'
          : 'Research acknowledgment was not received. The request may have reached the server; its outcome is unconfirmed. No automatic retry was sent.' });
      if (status === 403) void refresh();
    } finally { if (pending.current === controller) pending.current = null; }
  };
  return { request, notice: notice?.epoch === authEpoch && !readbackFailed ? notice : undefined };
}
