import { loadSettings } from "./settings";

// Soft interface sounds (taps, page switches, finished actions), made on the fly with Web Audio so
// there is nothing to download. Off unless both Sound and Interface sounds are on in Settings.

const TONES = {
  tap: [[880, 0.05]],
  step: [[660, 0.06]],
  done: [
    [660, 0.07],
    [990, 0.12],
  ],
  tick: [[1320, 0.03]],
  thud: [[220, 0.14]],
  win: [
    [660, 0.07],
    [880, 0.07],
    [1320, 0.16],
  ],
} as const;

let ctx: AudioContext | null = null;

export function chime(kind: keyof typeof TONES = "tap") {
  const s = loadSettings();
  if (!s.sound || !s.uiSound || typeof AudioContext === "undefined") return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    let at = ctx.currentTime + 0.005;
    for (const [freq, len] of TONES[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.06, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + len + 0.02);
      at += len * 0.8;
    }
  } catch {}
}
