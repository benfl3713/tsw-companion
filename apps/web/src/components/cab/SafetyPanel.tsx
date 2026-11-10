import type { CabValue } from "@tsw/shared";

const on = (v: CabValue | undefined) => v === true || (typeof v === "number" && v !== 0);

/** The AWS "sunflower": black at rest, yellow segments after a caution. */
export function Sunflower({ active }: { active: boolean }) {
  const segments = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    const a2 = ((i * 30 + 15) * Math.PI) / 180;
    return `M 0 0 L ${Math.sin(a) * 26} ${-Math.cos(a) * 26} L ${Math.sin(a2) * 26} ${-Math.cos(a2) * 26} z`;
  });
  return (
    <svg className={`sunflower ${active ? "on" : ""}`} viewBox="-30 -30 60 60" role="img" aria-label={active ? "AWS sunflower showing" : "AWS sunflower clear"}>
      <circle r={29} className="sf-rim" />
      {segments.map((d, i) => (
        <path key={i} d={d} className={i % 2 === 0 ? "sf-a" : "sf-b"} />
      ))}
    </svg>
  );
}

function Lamp({ label, lit, flashing, tone }: { label: string; lit: boolean; flashing?: boolean; tone: "red" | "amber" }) {
  return (
    <div className={`lamp ${tone} ${lit ? "lit" : ""} ${flashing ? "flash" : ""}`}>
      <span className="lamp-dot" />
      <span>{label}</span>
    </div>
  );
}

/** UK AWS / TPWS / DSD indicators. Values come from the loco's cab profile. */
export function SafetyPanel({ values }: { values: Record<string, CabValue> | undefined }) {
  // Non-UK stock has none of these.
  if (!values || (values.awsSunflower == null && values.tpwsTrainStop == null && values.dsdWarning == null)) return null;
  return (
    <div className="safety">
      <div className="safety-aws">
        <Sunflower active={on(values.awsSunflower)} />
        <span className="small muted">AWS</span>
      </div>
      <div className="safety-lamps">
        <Lamp label="Train stop" tone="red" lit={on(values.tpwsTrainStop)} flashing={on(values.tpwsTrainStopFlashing)} />
        <Lamp label="Overspeed" tone="red" lit={on(values.tpwsOverspeed)} flashing={on(values.tpwsOverspeedFlashing)} />
        <Lamp label="Brake demand" tone="red" lit={on(values.safetyBrakeDemand)} />
        <Lamp label="DSD" tone="amber" lit={on(values.dsdWarning) || on(values.dsdPenalty)} flashing={on(values.dsdWarning)} />
      </div>
    </div>
  );
}
