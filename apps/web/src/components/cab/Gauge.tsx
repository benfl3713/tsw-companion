const START = -120;
const SWEEP = 240;
const R = 80;

function polar(deg: number, r: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
}

export interface Needle {
  value: number | null;
  colour: "white" | "red" | "yellow";
}

interface Props {
  min?: number;
  max: number;
  majorStep: number;
  minorStep?: number;
  needles: Needle[];
  label: string;
  unit: string;
  /** Digits after the decimal point in the readout; null hides the readout. */
  digits?: number | null;
  /** Pointers on the outer edge, e.g. a speed-set bug. */
  markers?: { value: number; colour: "red" | "yellow" }[];
}

/** Round analogue gauge with up to two needles, in the style of a cab instrument. */
export function Gauge({ min = 0, max, majorStep, minorStep, needles, label, unit, digits = 1, markers = [] }: Props) {
  const angle = (v: number) => START + ((Math.min(Math.max(v, min), max) - min) / (max - min)) * SWEEP;
  const ticks = [];
  const minor = minorStep ?? majorStep / 2;
  for (let v = min; v <= max + 1e-9; v += minor) {
    const isMajor = Math.abs((v - min) / majorStep - Math.round((v - min) / majorStep)) < 1e-6;
    const a = polar(angle(v), R - (isMajor ? 12 : 6));
    const b = polar(angle(v), R);
    ticks.push(<line key={`t${v}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={isMajor ? "g-tick major" : "g-tick"} />);
    if (isMajor) {
      const p = polar(angle(v), R - 24);
      ticks.push(
        <text key={`l${v}`} x={p.x} y={p.y} className="g-tick-label" textAnchor="middle" dominantBaseline="central">
          {Number(v.toFixed(2))}
        </text>,
      );
    }
  }
  const primary = needles[0]?.value;

  return (
    <svg className="gauge" viewBox="-95 -95 190 175" role="img" aria-label={label}>
      <circle r={92} className="g-bezel" />
      <circle r={86} className="g-face" />
      {ticks}
      <text y={-34} className="g-label" textAnchor="middle">
        {label}
      </text>
      {markers.map((m, i) => (
        <g key={`m${i}`} transform={`rotate(${angle(m.value)})`}>
          <path d={`M 0 ${-R + 1} l -5 -8 h 10 z`} className={`g-needle ${m.colour}`} />
        </g>
      ))}
      {needles.map((n, i) =>
        n.value == null ? null : (
          <g key={i} transform={`rotate(${angle(n.value)})`}>
            <path d={`M -2.5 10 L 0 ${-R + 8} L 2.5 10 z`} className={`g-needle ${n.colour}`} />
          </g>
        ),
      )}
      <circle r={7} className="g-hub" />
      {digits != null && (
        <text y={44} className="g-readout" textAnchor="middle">
          {primary == null ? "--" : primary.toFixed(digits)}
        </text>
      )}
      <text y={58} className="g-unit" textAnchor="middle">
        {unit}
      </text>
    </svg>
  );
}
