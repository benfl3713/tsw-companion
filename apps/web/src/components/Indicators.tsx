import { formatCountdown, type ObjectiveState, type TrackStop, type UpcomingLimit, type UpcomingSignal } from "@tsw/shared";
import { HIDDEN_ASPECT } from "../settings";
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
            {next.aspect !== HIDDEN_ASPECT && <span className="muted small">{next.aspect.replace(/_/g, " ")}</span>}
          </div>
        </div>
      ) : (
        <span className="muted">None ahead</span>
      )}
    </section>
  );
}

/** A train describer headcode, e.g. "2K12", on its black plate. */
export function Headcode({ code }: { code: string }) {
  return <span className="headcode">{code}</span>;
}

/** The next stop as a station sign: white on blue, with the platform in its own badge. */
export function NextStop({ stop, unit }: { stop: TrackStop; unit: SpeedUnit }) {
  return (
    <section className="card sign-card">
      <h2>{stop.calling ? "Next stop" : "Next platform"}</h2>
      <div className="station-sign">
        <span className="station-name">{stop.name}</span>
        {stop.platform && (
          <span className="platform-badge" aria-label={`Platform ${stop.platform}`}>
            {stop.platform}
          </span>
        )}
      </div>
      <span className="distance">{formatDistance(Math.max(stop.distance, 0), unit)}</span>
    </section>
  );
}

/**
 * Service headcode and the current stop's dwell countdown and door waits. The
 * game's CurrentWaitTime can count either way; the bridge works out the seconds left.
 */
export function ServiceCard({ serviceName, objective }: { serviceName: string | null; objective: ObjectiveState | null }) {
  if (!serviceName && !objective) return null;
  const waiting = objective?.waitTime != null && objective.waitTime > 0;
  const remaining = waiting ? objective!.waitRemaining : null;
  return (
    <section className="card">
      <h2>Service</h2>
      <div className="col">
        {serviceName && <span className="service-name">{serviceName}</span>}
        {waiting && (
          <span className="fig-row">
            <span className="muted small">Dwell</span>
            <span className="fig">{remaining != null ? formatCountdown(remaining) : "--:--"}</span>
            {remaining === 0 && <span className="ok-text"> Ready to depart</span>}
          </span>
        )}
        {objective?.waitForDoorOpen && <span className="warn">Open the doors</span>}
        {objective?.waitForDoorClosed && <span className="warn">Close the doors</span>}
        {objective && !waiting && !objective.waitForDoorOpen && !objective.waitForDoorClosed && objective.kind && (
          <span className="muted small">Objective: {objective.kind.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>
        )}
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
