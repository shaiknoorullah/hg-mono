/**
 * The new-order chime, synthesised once at runtime into a WAV `data:` URI: no binary asset in
 * the repo and no new dependency. Two bright partials with a quick attack and a decaying
 * tail, then the same an octave-fifth up: it cuts through kitchen noise without being shrill.
 * `useOrderAlert` loops it every 4 s while any new order is waiting.
 */
const RATE = 22_050;

function tone(samples: Float32Array, startS: number, durS: number, freq: number, gain: number) {
  const start = Math.floor(startS * RATE);
  const len = Math.floor(durS * RATE);
  for (let i = 0; i < len && start + i < samples.length; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.01);
    const env = attack * Math.exp(-t * 6);
    const v = Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(2 * Math.PI * freq * 2 * t);
    samples[start + i] = (samples[start + i] ?? 0) + v * env * gain;
  }
}

function encodeWav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const str = (off: number, s: string) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(v * 0x7fff), true);
  }
  return bytes;
}

let cached: string | null = null;

/** The chime as a `data:audio/wav;base64,…` URI (built once, then cached). */
export function chimeUrl(): string {
  if (cached) return cached;
  const samples = new Float32Array(Math.floor(RATE * 0.9));
  tone(samples, 0, 0.45, 880, 0.45);
  tone(samples, 0.18, 0.7, 1318.5, 0.4);
  const bytes = encodeWav(samples);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  cached = `data:audio/wav;base64,${btoa(bin)}`;
  return cached;
}
