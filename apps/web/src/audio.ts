import { useEffect, useRef, useState } from "react";

// Synthesised alert tones (no audio files). Browsers only allow sound after a
// user gesture, so the context is created when the driver taps "Sound on".

const STORAGE_KEY = "tsw.sound";

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  return ctx;
}

function tone(freq: number, start: number, duration: number, type: OscillatorType = "sine", gain = 0.18) {
  const c = context();
  if (!c || c.state !== "running") return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  amp.gain.setValueAtTime(gain, t0 + duration - 0.03);
  amp.gain.linearRampToValueAtTime(0, t0 + duration);
  osc.connect(amp).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export type AlertSound = "approach" | "brake" | "urgent" | "overspeed" | "aws" | "dsd";

/** One burst of each alert; repeating alerts call this on an interval. */
export function play(sound: AlertSound) {
  switch (sound) {
    case "approach": // soft ping
      tone(880, 0, 0.18);
      break;
    case "brake": // falling two-tone
      tone(988, 0, 0.16);
      tone(740, 0.18, 0.22);
      break;
    case "urgent": // fast triple
      for (let i = 0; i < 3; i++) tone(1175, i * 0.14, 0.1, "square", 0.12);
      break;
    case "overspeed":
      tone(660, 0, 0.12, "triangle");
      tone(660, 0.2, 0.12, "triangle");
      break;
    case "aws": // AWS horn: harsh continuous-sounding burst
      tone(440, 0, 0.9, "sawtooth", 0.1);
      tone(554, 0, 0.9, "sawtooth", 0.06);
      break;
    case "dsd":
      tone(1400, 0, 0.25, "square", 0.08);
      break;
  }
}

/** Whether sound is on; turning it on must happen inside a tap handler. */
export function useSound(): [boolean, () => void] {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "on" && context()?.state === "running";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    const next = !enabled;
    if (next) {
      void context()?.resume();
      play("approach");
    }
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Not persisted; fine.
    }
  };
  return [enabled, toggle];
}

/**
 * Plays `sound` once when `active` turns on and, if `repeatMs` is set, keeps
 * repeating it while it stays on.
 */
export function useAlertSound(enabled: boolean, active: boolean, sound: AlertSound, repeatMs?: number) {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !active) return;
    play(sound);
    if (repeatMs) timer.current = window.setInterval(() => play(sound), repeatMs);
    return () => window.clearInterval(timer.current);
  }, [enabled, active, sound, repeatMs]);
}
