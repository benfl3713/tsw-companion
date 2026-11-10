import {
  clockSeconds,
  doorCue,
  doorsClosedFrom,
  estimateArrivals,
  formatClock,
  formatCountdown,
  type DoorStage,
  type Telemetry,
} from "@tsw/shared";
import { useSettings } from "../settings";
import type { StopHistory } from "../stopHistory";
import { formatDistance, type SpeedUnit } from "../units";
import { Headcode } from "./Indicators";

const STAGES: { stage: DoorStage; label: string }[] = [
  { stage: "dwell", label: "Doors open" },
  { stage: "close", label: "Close doors" },
  { stage: "ready", label: "Locked" },
];

/** How far through the door sequence we are, for lighting the steps. */
function stageIndex(stage: DoorStage): number {
  return stage === "open" || stage === "dwell" ? 0 : stage === "close" ? 1 : stage === "ready" ? 2 : -1;
}

function lateness(seconds: number): { text: string; tone: "ok" | "warn" | "late" } {
  const s = Math.round(seconds);
  if (Math.abs(s) <= 15) return { text: "On time", tone: "ok" };
  return s > 0 ? { text: `${formatCountdown(s)} late`, tone: "late" } : { text: `${formatCountdown(-s)} early`, tone: "warn" };
}

interface Props {
  t: Telemetry;
  unit: SpeedUnit;
  history: StopHistory;
  onClose: () => void;
}

/**
 * Floating schedule: where the train is calling, when it should get there, and
 * the dwell and door timeline at the current station. Doesn't dim or block the
 * view behind it, so it can stay open while driving.
 */
export function SchedulePanel({ t, unit, history, onClose }: Props) {
  const { settings } = useSettings();
  const speed = t.drive?.speed ?? 0;
  const clock = clockSeconds(t.world?.localTimeIso);
  const stops = (t.track?.stops ?? []).filter((s) => s.distance > -AT_STOP_M);
  const aid = t.driverAid;
  const objective = t.objective;

  const arrivals = estimateArrivals({
    speed,
    stops: stops.map((s) => ({ distance: Math.max(0, s.distance) })),
    limits: (aid?.limits ?? []).map((l) => ({ distance: l.distance, limit: l.limit })),
    currentLimit: aid?.speedLimit ?? null,
    cap: aid?.formationMaxSpeed ?? undefined,
  });

  const cue = doorCue({
    speed,
    objective,
    doorsClosed: doorsClosedFrom(t.cab?.values),
    leadSeconds: settings.doorLeadSeconds,
  });
  const here = history.here;
  const showDoors = here != null || cue.stage !== "none";
  const active = stageIndex(cue.stage);

  // Running time against the schedule, when the game gave a scheduled time for this stop.
  let running: ReturnType<typeof lateness> | null = null;
  if (objective?.scheduledTime != null && clock != null) {
    const expected = objective.waitRemaining != null && !objective.scheduledIsArrival ? clock + objective.waitRemaining : clock;
    running = lateness(expected - objective.scheduledTime);
  }

  const serviceName = t.position?.serviceName ?? null;

  return (
    <aside className="schedule-pop" role="dialog" aria-label="Schedule">
      <header className="schedule-head">
        <div className="schedule-title">
          {serviceName ? <Headcode code={serviceName} /> : <span className="muted">Free roam</span>}
          <span className="fig clock-fig">{clock != null ? formatClock(clock, true) : "--:--:--"}</span>
        </div>
        <button className="unit-toggle icon" onClick={onClose} aria-label="Close schedule">
          ✕
        </button>
      </header>

      <div className="schedule-body">
        {showDoors && (
          <section className="sched-now">
            <div className="sched-now-head">
              <span className="sched-kicker">{here ? "At station" : "Departure"}</span>
              <span className="sched-station">
                {here ? here.name : (stops[0]?.name ?? "")}
                {here?.platform && <span className="platform-badge small">{here.platform}</span>}
              </span>
            </div>
            <div className="sched-count">
              <span className="fig big">{cue.secondsLeft != null ? formatCountdown(cue.secondsLeft) : "--:--"}</span>
              <span className="muted small">{cue.secondsLeft != null ? "until departure" : "dwell not reported"}</span>
              {running && <span className={`chip-late ${running.tone}`}>{running.text}</span>}
            </div>
            <ol className="door-steps" aria-label="Door sequence">
              {STAGES.map((s, i) => (
                <li key={s.stage} className={i < active ? "done" : i === active ? "now" : ""}>
                  <span className="step-dot" />
                  {s.label}
                </li>
              ))}
              <li className={cue.stage === "ready" && cue.secondsLeft === 0 ? "now go" : ""}>
                <span className="step-dot" />
                Depart
              </li>
            </ol>
            {cue.message && <p className={`door-message ${cue.stage}`}>{cue.message}</p>}
            {objective?.scheduledTime != null && (
              <p className="muted small">
                Scheduled {objective.scheduledIsArrival ? "arrival" : "departure"} {formatClock(objective.scheduledTime)}
              </p>
            )}
          </section>
        )}

        <h2 className="sched-heading">{stops[0]?.calling ? "Calling at" : "Platforms ahead"}</h2>
        {stops.length === 0 ? (
          <p className="muted small">No stops reported ahead.</p>
        ) : (
          <ol className="sched-list">
            {stops.map((s, i) => (
              <li key={`${s.name}-${s.platform}-${i}`} className={i === 0 ? "next" : ""}>
                <span className="sched-line" aria-hidden>
                  <i />
                </span>
                <span className="sched-name">
                  {s.name}
                  {s.platform && <span className="platform-badge small">{s.platform}</span>}
                </span>
                <span className="sched-dist">{formatDistance(Math.max(0, s.distance), unit)}</span>
                <span className="sched-eta fig small">{clock != null ? `~${formatClock(clock + (arrivals[i] ?? 0))}` : "--:--"}</span>
              </li>
            ))}
          </ol>
        )}

        {history.called.length > 0 && (
          <>
            <h2 className="sched-heading">Called at</h2>
            <ol className="sched-list called">
              {[...history.called].reverse().map((s, i) => (
                <li key={`${s.name}-${s.arrived}-${i}`}>
                  <span className="sched-line" aria-hidden>
                    <i />
                  </span>
                  <span className="sched-name">
                    {s.name}
                    {s.platform && <span className="platform-badge small">{s.platform}</span>}
                  </span>
                  <span className="sched-dist">arr {formatClock(s.arrived)}</span>
                  <span className="sched-eta fig small">{s.departed != null ? `dep ${formatClock(s.departed)}` : ""}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      <footer className="schedule-foot">
        Times marked ~ are estimates from your speed and the limits ahead. The game doesn't share the timetable's
        scheduled times{objective?.scheduledTime != null ? " (shown above where it does)" : ""}.
      </footer>
    </aside>
  );
}

/** A train this close to a stop's stopping point counts as at it. */
const AT_STOP_M = 80;
