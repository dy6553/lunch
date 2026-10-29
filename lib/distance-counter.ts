export type DistanceFrame = [number, number, number];
export type DistanceCounter = {
  threshold: number; last: number; armed: boolean; blocked: boolean;
  pending: boolean; blockedSamples: number; clearSamples: number; clearSince: number;
};
export function processDistanceFrames(frames: DistanceFrame[], saved: string, threshold: number) {
  let state: DistanceCounter = {threshold, last: -1, armed: false, blocked: false, pending: false, blockedSamples: 0, clearSamples: 0, clearSince: -1};
  try {
    const previous = JSON.parse(saved);
    if (previous.threshold === threshold && Number.isSafeInteger(previous.last) &&
      ['armed', 'blocked', 'pending'].every(k => typeof previous[k] === 'boolean') &&
      ['blockedSamples', 'clearSamples', 'clearSince'].every(k => Number.isSafeInteger(previous[k]))) state = previous;
    else if (Number.isSafeInteger(previous.last)) state.last = previous.last;
  } catch { /* First batch or a corrupt saved state starts unarmed. */ }
  const passages: number[] = [];
  for (const [at, mm, quality] of frames) {
    if (at <= state.last) continue;
    if (at - state.last > 250) { state.blockedSamples = state.clearSamples = 0; state.clearSince = -1; }
    state.last = at;
    if (quality === 0) { state.blockedSamples = state.clearSamples = 0; state.clearSince = -1; continue; }
    if (quality === 1 && mm > 0 && mm < threshold) {
      state.clearSamples = 0; state.clearSince = -1;
      state.blockedSamples = Math.min(3, state.blockedSamples + 1);
      if (!state.blocked && state.blockedSamples >= 3) {
        state.blocked = true; state.pending = state.armed; state.armed = false;
      }
    } else if (quality === 2 || mm >= threshold + 150) {
      state.blockedSamples = 0;
      if (state.clearSamples === 0) state.clearSince = at;
      state.clearSamples = Math.min(3, state.clearSamples + 1);
      if (state.clearSamples >= 3 && at - state.clearSince >= 500) {
        if (state.blocked && state.pending) passages.push(at);
        state.blocked = state.pending = false; state.armed = true;
      }
    } else { state.blockedSamples = state.clearSamples = 0; state.clearSince = -1; }
  }
  return {state, passages};
}
