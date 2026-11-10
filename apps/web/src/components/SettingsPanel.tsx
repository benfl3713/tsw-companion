import { useSettings, type AlertKey } from "../settings";
import { UNIT_LABEL, type SpeedUnit } from "../units";

const ALERTS: { key: AlertKey; label: string; detail: string }[] = [
  { key: "aws", label: "AWS", detail: "Acknowledge after a caution magnet" },
  { key: "vigilance", label: "Vigilance / DSD", detail: "Driver's safety device and alerter" },
  { key: "brakeDemand", label: "Brake demand", detail: "TPWS, AWS or DSD has applied the brakes" },
  { key: "wheelslip", label: "Wheelslip", detail: "Wheels slipping or sliding" },
  { key: "overspeed", label: "Overspeed", detail: "Above the current limit" },
  { key: "braking", label: "Braking advice", detail: "Brake points for lower limits and red signals" },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}

interface Props {
  unit: SpeedUnit;
  sound: boolean;
  /** Whether keep-awake is currently holding the screen on. */
  awake: boolean;
  onToggleSound: () => void;
  onClose: () => void;
}

export function SettingsPanel({ unit, sound, awake, onToggleSound, onClose }: Props) {
  const { settings, update, reset } = useSettings();

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h1>Settings</h1>
          <button className="unit-toggle" onClick={onClose}>
            Done
          </button>
        </header>

        <h2>Alerts</h2>
        <div className="settings-table">
          <div className="settings-row header">
            <span />
            <span>Show</span>
            <span>Sound</span>
          </div>
          {ALERTS.map(({ key, label, detail }) => (
            <div className="settings-row" key={key}>
              <div className="col">
                <span>{label}</span>
                <span className="muted small">{detail}</span>
              </div>
              <Toggle
                label={`Show ${label}`}
                on={settings.alerts[key]}
                onChange={(on) => update({ alerts: { ...settings.alerts, [key]: on } })}
              />
              <Toggle
                label={`Sound for ${label}`}
                on={settings.alerts[key] && settings.sounds[key]}
                onChange={(on) => update({ sounds: { ...settings.sounds, [key]: on } })}
              />
            </div>
          ))}
        </div>
        <div className="settings-row single">
          <div className="col">
            <span>Alert sounds on this device</span>
            <span className="muted small">Browsers need a tap here before they allow sound.</span>
          </div>
          <Toggle label="Alert sounds" on={sound} onChange={onToggleSound} />
        </div>

        <h2>Overspeed</h2>
        <label className="settings-slider">
          <span>
            Warn at <b>+{settings.overspeedTolerance}</b> {UNIT_LABEL[unit]} over the limit
          </span>
          <input
            type="range"
            min={0}
            max={5}
            step={1}
            value={settings.overspeedTolerance}
            onChange={(e) => update({ overspeedTolerance: Number(e.target.value) })}
          />
        </label>

        <h2>Braking advice</h2>
        <div className="segmented wide" role="radiogroup">
          {(
            [
              ["countdown", "Countdown + brake points"],
              ["brake-points", "Brake points only"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="radio"
              aria-checked={settings.brakingAdvice === value}
              className={settings.brakingAdvice === value ? "on" : ""}
              onClick={() => update({ brakingAdvice: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="settings-slider">
          <span>
            Plan with service braking of <b>{settings.comfortDecel.toFixed(2)}</b> m/s²
            <span className="muted small"> (lower = earlier brake points)</span>
          </span>
          <input
            type="range"
            min={0.25}
            max={0.8}
            step={0.05}
            value={settings.comfortDecel}
            onChange={(e) => {
              const comfortDecel = Number(e.target.value);
              update({ comfortDecel, urgentDecel: Math.max(settings.urgentDecel, comfortDecel + 0.1) });
            }}
          />
        </label>
        <label className="settings-slider">
          <span>
            "Brake hard" above <b>{settings.urgentDecel.toFixed(2)}</b> m/s²
          </span>
          <input
            type="range"
            min={0.4}
            max={1.4}
            step={0.05}
            value={settings.urgentDecel}
            onChange={(e) =>
              update({ urgentDecel: Math.max(Number(e.target.value), settings.comfortDecel + 0.1) })
            }
          />
        </label>

        <h2>Cab displays</h2>
        <div className="settings-row single">
          <div className="col">
            <span>ETCS planning area</span>
            <span className="muted small">
              Show limits, gradients and red signals ahead on the 700/80x display. Off matches a real DMI outside ETCS areas.
            </span>
          </div>
          <Toggle label="ETCS planning area" on={settings.dmiPlanning} onChange={(on) => update({ dmiPlanning: on })} />
        </div>

        <h2>This device</h2>
        <div className="settings-row single">
          <div className="col">
            <span>Keep screen awake</span>
            <span className="muted small">
              {settings.keepAwake
                ? awake
                  ? "On: the screen won't dim while the app is open."
                  : "Starts on your next tap."
                : "The screen dims and locks as normal."}
            </span>
          </div>
          <Toggle label="Keep screen awake" on={settings.keepAwake} onChange={(on) => update({ keepAwake: on })} />
        </div>
        <div className="settings-row single">
          <div className="col">
            <span>Full-screen app on iPad</span>
            <span className="muted small">
              In Safari, tap Share, then Add to Home Screen. Open TSW Cab from the home screen for a full-screen app.
            </span>
          </div>
          <button className="unit-toggle" onClick={() => location.reload()}>
            Reload
          </button>
        </div>

        <footer className="sheet-foot">
          <span className="muted small">Settings are saved on this device only.</span>
          <button className="unit-toggle" onClick={reset}>
            Reset to defaults
          </button>
        </footer>
      </section>
    </div>
  );
}
