export function crossfade(value) {
  const x = Math.max(0, Math.min(1, Number(value)));
  return [Math.cos(x * Math.PI / 2), Math.sin(x * Math.PI / 2)];
}
export function positionAt(offset, elapsed, rate, duration, loop) {
  let pos = offset + Math.max(0, elapsed) * rate;
  if (loop && pos >= loop.end) pos = loop.start + (pos - loop.start) % (loop.end - loop.start);
  return Math.max(0, Math.min(duration, pos));
}
export function waveform(samples, bins = 600) {
  const result = [];
  for (let i = 0; i < bins; i++) {
    let peak = 0;
    const start = Math.floor(i * samples.length / bins), end = Math.floor((i + 1) * samples.length / bins);
    for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(samples[j]));
    result.push(peak);
  }
  return result;
}
// Onset-envelope autocorrelation. Estimate only: variable-tempo and quiet tracks need manual correction.
export function estimateBpm(samples, sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate / 200));
  const count = Math.min(Math.floor(samples.length / hop), 12000);
  if (count < 400) return null;
  const env = new Float32Array(count);
  let previous = 0, total = 0;
  for (let i = 0; i < count; i++) {
    let energy = 0;
    for (let j = 0; j < hop; j++) energy += samples[i * hop + j] ** 2;
    energy = Math.sqrt(energy / hop);
    env[i] = Math.max(0, energy - previous);
    total += env[i]; previous = energy;
  }
  if (total < 0.001) return null;
  const mean = total / count;
  let bestScore = 0, bestLag = 0;
  for (let lag = Math.floor(200 * 60 / 160); lag <= Math.ceil(200 * 60 / 80); lag++) {
    let score = 0;
    for (let i = lag; i < count; i++) score += (env[i] - mean) * (env[i - lag] - mean);
    score /= count - lag;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  return bestLag ? Math.round(12000 / bestLag * 10) / 10 : null;
}
export function synthesize(sampleRate, bpm, seed = 1, bars = 16) {
  const duration = bars * 4 * 60 / bpm;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  const beat = 60 / bpm;
  let random = seed;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, step = Math.floor(t / beat), phase = t % beat;
    random = (Math.imul(random, 1664525) + 1013904223) | 0;
    const noise = random / 2147483648;
    const kick = Math.sin(2 * Math.PI * (48 * phase + 10 * (1 - Math.exp(-35 * phase)))) * Math.exp(-20 * phase) * 0.65;
    const hatPhase = t % (beat / 2);
    const hat = noise * Math.exp(-110 * hatPhase) * 0.12;
    const clap = step % 2 ? noise * Math.exp(-36 * phase) * 0.13 : 0;
    const root = seed === 1 ? 55 : seed === 2 ? 65.406 : 73.416;
    const note = [0, 0, 7, 3][Math.floor(step / 4) % 4];
    const freq = root * 2 ** (note / 12);
    const bass = Math.sin(2 * Math.PI * freq * t) * (1 - Math.exp(-18 * phase)) * Math.exp(-3 * phase) * 0.21;
    const arpPhase = t % (beat / 2);
    const arpFreq = freq * 4 * 2 ** ([0, 7, 12, 15][Math.floor(t / (beat / 2)) % 4] / 12);
    const arp = Math.sin(2 * Math.PI * arpFreq * t) * Math.exp(-16 * arpPhase) * 0.06;
    const fade = Math.min(1, t * 20, (duration - t) * 20);
    samples[i] = (kick + hat + clap + bass + arp) * Math.max(0, fade);
  }
  return samples;
}
