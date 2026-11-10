import { flag, TmsDisplay, type TmsScreenProps } from "./TmsDisplay";

/** Display in the style of Hitachi AT300 units (Class 800/805). */
export function HitachiAt300(props: TmsScreenProps) {
  const v = props.values ?? {};
  if (v.displayPowered === false) {
    return <div className="at-screen at-off">Display not powered</div>;
  }
  return (
    <TmsDisplay
      {...props}
      theme="theme-hitachi"
      tiles={[
        { label: flag(v.engineRunning) ? "Diesel" : "Electric", state: "on" },
        { label: "Line powered", state: flag(v.trainLinePowered) ? "on" : "off" },
        { label: "Traction lock", state: flag(v.tractionLocked) || props.drive.isTractionLocked ? "warn" : "off" },
        { label: "DRA", state: flag(v.draSet) ? "warn" : "off" },
        { label: "Brake hold", state: flag(v.brakeHoldSpeedReached) ? "on" : "off" },
        { label: "Wheelslip", state: props.drive.isSlipping ? "warn" : "off" },
      ]}
    />
  );
}
