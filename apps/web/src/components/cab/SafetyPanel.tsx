import { awsWarningActive, dsdWarningActive, on, type CabValue } from "@tsw/shared";

/**
 * The AWS "sunflower": an all-black disc normally, yellow and black spokes
 * after a caution. A flashing ring means a warning is waiting to be acknowledged.
 */
export function Sunflower({
  active,
  warning = false,
  size = 56,
}: {
  active: boolean;
  warning?: boolean;
  size?: number;
}) {
  const spokes = 8;
  const segments = Array.from({ length: spokes }, (_, i) => {
    const step = 360 / spokes;
    const a = (i * step * Math.PI) / 180;
    const a2 = ((i * step + step / 2) * Math.PI) / 180;
    return `M 0 0 L ${Math.sin(a) * 25} ${-Math.cos(a) * 25} A 25 25 0 0 1 ${Math.sin(a2) * 25} ${-Math.cos(a2) * 25} z`;
  });
  return (
    <svg
      className={`sunflower ${active ? "on" : ""} ${warning ? "warning" : ""}`}
      viewBox="-30 -30 60 60"
      width={size}
      height={size}
      role="img"
      aria-label={warning ? "AWS warning: acknowledge" : active ? "AWS sunflower showing" : "AWS sunflower clear"}
    >
      <circle r={29} className="sf-rim" />
      <circle r={26} className="sf-disc" />
      {segments.map((d, i) => (
        <path key={i} d={d} className="sf-spoke" />
      ))}
      <circle r={5} className="sf-hub" />
    </svg>
  );
}

/** A large, labelled AWS indicator for the cab desks. */
export function AwsIndicator({ values, size = 104 }: { values: Record<string, CabValue> | undefined; size?: number }) {
  if (!values || values.awsSunflower == null) return null;
  const warning = awsWarningActive(values);
  const active = on(values.awsSunflower);
  return (
    <div className={`aws-indicator ${warning ? "warning" : ""}`}>
      <Sunflower active={active} warning={warning} size={size} />
      <span className="aws-caption">AWS</span>
      <span className={`aws-state ${warning ? "warn" : active ? "caution" : ""}`}>
        {warning ? "Acknowledge" : active ? "Caution" : "Clear"}
      </span>
    </div>
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
export function SafetyPanel({
  values,
  showAws = true,
}: {
  values: Record<string, CabValue> | undefined;
  /** Desks that place the sunflower elsewhere (beside their instruments) turn it off here. */
  showAws?: boolean;
}) {
  // Non-UK stock has none of these.
  if (
    !values ||
    (values.awsSunflower == null && values.tpwsTrainStop == null && values.dsdWarning == null && values.dsdElapsed == null)
  ) {
    return null;
  }
  const dsd = dsdWarningActive(values);
  return (
    <div className="safety">
      {showAws && <AwsIndicator values={values} size={92} />}
      <div className="safety-lamps">
        <Lamp label="Train stop" tone="red" lit={on(values.tpwsTrainStop)} flashing={on(values.tpwsTrainStopFlashing)} />
        <Lamp label="Overspeed" tone="red" lit={on(values.tpwsOverspeed)} flashing={on(values.tpwsOverspeedFlashing)} />
        <Lamp label="Brake demand" tone="red" lit={on(values.safetyBrakeDemand)} />
        <Lamp label="DSD" tone="amber" lit={dsd || on(values.dsdPenalty)} flashing={dsd} />
      </div>
    </div>
  );
}
