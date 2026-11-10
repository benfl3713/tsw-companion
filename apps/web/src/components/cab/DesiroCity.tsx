import { flag, TmsDisplay, type TmsScreenProps } from "./TmsDisplay";

/** Display in the style of Siemens Desiro City units (Class 700/707), dual voltage. */
export function DesiroCity(props: TmsScreenProps) {
  const v = props.values ?? {};
  // Which supply the unit is drawing from. Collector "deployed" flags can both
  // be set at once, so go by the supply first and the requested mode second.
  const ac = flag(v.acSupply) || (!flag(v.dcSupply) && flag(v.wantAcMode));
  const supplied = ac ? flag(v.acSupply) && !flag(v.acBreakerOpen) : flag(v.dcSupply) && !flag(v.dcBreakerOpen);
  const destination = typeof v.destination === "string" && v.destination.trim() ? v.destination : null;

  return (
    <TmsDisplay
      {...props}
      theme="theme-siemens"
      banner={destination ? <div className="at-banner">To {destination}</div> : undefined}
      tiles={[
        { label: ac ? "25 kV AC" : "750 V DC", state: flag(v.powerModeChanging) ? "warn" : supplied ? "on" : "warn" },
        { label: "Pantograph", state: flag(v.pantographUp) ? "on" : "off" },
        { label: "Shoes", state: flag(v.shoesDown) ? "on" : "off" },
        { label: "Regen brake", state: flag(ac ? v.regenAc : v.regenDc) ? "on" : "off" },
        { label: "Brake hold", state: flag(v.brakeHoldSpeed) ? "on" : "off" },
        {
          label: flag(v.emergencyHold) ? "Emergency hold" : "Traction lock",
          state: flag(v.emergencyHold) || flag(v.tractionLocked) || props.drive.isTractionLocked ? "warn" : "off",
        },
      ]}
    />
  );
}
