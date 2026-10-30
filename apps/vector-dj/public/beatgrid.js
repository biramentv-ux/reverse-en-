const EPSILON = 1e-9;
function beatLength(bpm) {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('Set a valid BPM first.');
  return 60 / bpm;
}
export function beatPhase(position, bpm, anchor = 0) {
  const beats = (position - anchor) / beatLength(bpm);
  return ((beats % 1) + 1) % 1;
}
export function quantizePosition(position, bpm, anchor, duration) {
  const beat = beatLength(bpm);
  const first = Math.ceil(-anchor / beat - EPSILON);
  const last = Math.floor((duration - anchor) / beat + EPSILON);
  if (first > last) throw new Error('No complete grid point in this track.');
  const n = Math.max(first, Math.min(last, Math.round((position - anchor) / beat)));
  return Math.max(0, Math.min(duration, anchor + n * beat));
}
export function beatLoop(position, bpm, anchor, beats, duration) {
  const beat = beatLength(bpm);
  if (!Number.isFinite(beats) || beats <= 0) return null;
  const first = Math.ceil(-anchor / beat - EPSILON);
  const n = Math.max(first, Math.floor((position - anchor) / beat + EPSILON));
  const start = Math.max(0, anchor + n * beat), end = start + beats * beat;
  // A shortened final loop would change the phase on every repetition.
  if (end > duration + EPSILON) return null;
  return { start, end: Math.min(duration, end) };
}
export function syncPlan({ followerPosition, followerBpm, followerAnchor = 0, duration,
  masterPosition, masterBpm, masterAnchor = 0, masterRate = 1, loop = null }) {
  const beat = beatLength(followerBpm), masterBeat = beatLength(masterBpm);
  if (![followerPosition, followerAnchor, duration, masterPosition, masterAnchor, masterRate].every(Number.isFinite) || duration <= 0 || masterRate <= 0) throw new Error('Invalid track or tempo for beat alignment.');
  const phase = beatPhase(masterPosition, masterBpm, masterAnchor);
  const low = loop?.start ?? 0, high = (loop?.end ?? duration) - 1e-6;
  const first = Math.ceil((low - followerAnchor) / beat - phase - EPSILON);
  const last = Math.floor((high - followerAnchor) / beat - phase + EPSILON);
  if (first > last) throw new Error('Not enough audio left to align this beat.');
  const n = Math.max(first, Math.min(last, Math.round((followerPosition - followerAnchor) / beat - phase)));
  return { position: followerAnchor + (n + phase) * beat, rate: masterRate * beat / masterBeat, phase };
}
