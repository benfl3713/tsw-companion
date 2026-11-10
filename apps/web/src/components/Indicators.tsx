import type { UpcomingLimit, UpcomingSignal } from "@tsw/shared";
import { formatDistance, limitIn, type SpeedUnit } from "../units";

/** Rough colour class for the HUD's aspect names. Unknown names show as text only. */
export function aspectColour(aspect: string): "red" | "yellow" | "double-yellow" | "green" | "unknown" {
  const a = aspect.toLowerCase();
  if (a.includes("stop") || a.includes("danger")) return "red";
  if (a.includes("approach_2") || a.includes("preliminary") || a.includes("double")) return "double-yellow";
  if (a.includes("approach") || a.includes("caution") || a.includes("warning") || a.includes("restrict")) return "yellow";
  if (a.includes("clear") || a.includes("proceed")) return "green";
  return "unknown";
}

export function LimitSign({ value, size = "large" }: { value: number | null; size?: "large" | "small" }) {
  return <div className={`limit-sign ${size}`}>{value ?? "–"}</div>;
}

export function CurrentLimit({ limit, unit }: { limit: number | null; unit: SpeedUnit }) {
  return (
    <section className="card">
      <h2>Limit</h2>
      <LimitSign value={limitIn(limit, unit)} />
    </section>
  );
}

export function NextLimit({ next, unit }: { next: UpcomingLimit | undefined; unit: SpeedUnit }) {
  return (
    <section className="card">
      <h2>Next limit</h2>
      {next ? (
        <div className="row">
          <LimitSign value={limitIn(next.limit, unit)} size="small" />
          <span className="distance">{formatDistance(next.distance, unit)}</span>
        </div>
      ) : (
        <span className="muted">None ahead</span>
      )}
    </section>
  );
}

export function NextSignal({ next, unit }: { next: UpcomingSignal | undefined; unit: SpeedUnit }) {
  const colour = next ? aspectColour(next.aspect) : "unknown";
  return (
    <section className="card">
      <h2>Next signal</h2>
      {next ? (
        <div className="row">
          <div className={`signal-head ${colour}`} aria-hidden>
            <i />
            <i />
          </div>
          <div className="col">
            <span className="distance">{formatDistance(next.distance, unit)}</span>
            <span className="muted small">{next.aspect.replace(/_/g, " ")}</span>
          </div>
        </div>
      ) : (
        <span className="muted">None ahead</span>
      )}
    </section>
  );
}

export function NextStop({ name, distance, unit }: { name: string; distance: number; unit: SpeedUnit }) {
  return (
    <section className="card">
      <h2>Next platform</h2>
      <div className="col">
        <span className="stop-name">{name}</span>
        <span className="distance">{formatDistance(distance, unit)}</span>
      </div>
    </section>
  );
}

export function Gradient({ gradient }: { gradient: number }) {
  const label = gradient === 0 ? "Level" : `1 in ${Math.round(100 / Math.abs(gradient))}`;
  return (
    <section className="card">
      <h2>Gradient</h2>
      <div className="row">
        <span className={`gradient-arrow ${gradient > 0 ? "up" : gradient < 0 ? "down" : "level"}`} aria-hidden />
        <span className="distance">{label}</span>
        {gradient !== 0 && <span className="muted small">{gradient.toFixed(1)}%</span>}
      </div>
    </section>
  );
}

export function Bar({ label, value, max, display }: { label: string; value: number; max: number; display: string }) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0)) * 100;
  return (
    <div className="bar">
      <div className="bar-head">
        <span>{label}</span>
        <span className="bar-value">{display}</span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
