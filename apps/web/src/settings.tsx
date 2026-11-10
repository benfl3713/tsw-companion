import { createContext, useContext, useState, type ReactNode } from "react";

// Per-device preferences, kept in this browser's localStorage. Each tablet
// or phone can be set up differently.

export type AlertKey = "aws" | "vigilance" | "brakeDemand" | "wheelslip" | "overspeed" | "braking" | "doors";

export interface Settings {
  /** Which banners to show. */
  alerts: Record<AlertKey, boolean>;
  /** Which of the shown alerts also make a sound (when sound is on). */
  sounds: Record<AlertKey, boolean>;
  /** Overspeed warning starts this far over the limit, in the display unit. */
  overspeedTolerance: number;
  /** "countdown" also shows "Brake in …" before the brake point. */
  brakingAdvice: "countdown" | "brake-points";
  /** Start asking for the doors to be closed this many seconds before departure. */
  doorLeadSeconds: number;
  /** Normal service braking rate the advice plans with, m/s². */
  comfortDecel: number;
  /** Above this the advice says "BRAKE HARD", m/s². */
  urgentDecel: number;
  /** Fill the ETCS display's planning area from the game's lookahead (a real non-ETCS DMI leaves it blank). */
  dmiPlanning: boolean;
  /** Stop the tablet dimming and locking while the app is open. */
  keepAwake: boolean;
  /** Show the Ahead strip beside the cab desk. */
  cabShowAhead: boolean;
  /**
   * Show what each signal ahead is showing. Off keeps where signals are but
   * not their aspect, so you read the real signal (braking advice then
   * ignores signals too, as it would give red ones away).
   */
  showAspects: boolean;
}

const ALL_ON: Record<AlertKey, boolean> = {
  aws: true,
  vigilance: true,
  brakeDemand: true,
  wheelslip: true,
  overspeed: true,
  braking: true,
  doors: true,
};

export const DEFAULT_SETTINGS: Settings = {
  alerts: { ...ALL_ON },
  sounds: { ...ALL_ON },
  overspeedTolerance: 1,
  brakingAdvice: "countdown",
  doorLeadSeconds: 20,
  comfortDecel: 0.45,
  urgentDecel: 0.8,
  dmiPlanning: true,
  keepAwake: true,
  cabShowAhead: true,
  showAspects: true,
};

const STORAGE_KEY = "tsw.settings";

/** Fills in anything missing from older saved settings. */
function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Settings> | null;
    if (!saved) return DEFAULT_SETTINGS;
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      alerts: { ...DEFAULT_SETTINGS.alerts, ...saved.alerts },
      sounds: { ...DEFAULT_SETTINGS.sounds, ...saved.sounds },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  const save = (next: Settings) => {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not persisted; the settings still apply until reload.
    }
  };
  return (
    <SettingsContext.Provider
      value={{ settings, update: (patch) => save({ ...settings, ...patch }), reset: () => save(DEFAULT_SETTINGS) }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

/**
 * The lookahead as the driver should see it: with aspects hidden, signals
 * keep their positions but lose what they show, so nothing downstream
 * (colours, braking advice for red signals) can give it away.
 */
export function visibleDriverAid<T extends { signals: { aspect: string }[] } | null>(aid: T, showAspects: boolean): T {
  if (!aid || showAspects) return aid;
  return { ...aid, signals: aid.signals.map((s) => ({ ...s, aspect: HIDDEN_ASPECT })) };
}

/** Placeholder aspect when aspects are hidden; matches no colour or stop rule. */
export const HIDDEN_ASPECT = "Hidden";

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
