import { EtcsDmi } from "./EtcsDmi";
import { flag, TmsDisplay, type CabDeskProps } from "./TmsDisplay";

/**
 * Class 700/707 (Siemens Desiro City) desk: the ETCS DMI as the speedometer
 * and the train control screen beside it. Dual voltage (25 kV AC / 750 V DC).
 */
export function DesiroCity({ t, drive, unit, maxSpeed, message }: CabDeskProps) {
  const v = t.cab?.values ?? {};
  // Which supply the unit is drawing from. Collector "deployed" flags can both
  // be set at once, so go by the supply first and the requested mode second.
  const ac = flag(v.acSupply) || (!flag(v.dcSupply) && flag(v.wantAcMode));
  const supplied = ac ? flag(v.acSupply) && !flag(v.acBreakerOpen) : flag(v.dcSupply) && !flag(v.dcBreakerOpen);
  const destination = typeof v.destination === "string" && v.destination.trim() ? v.destination : null;

  return (
    <div className="desk desk-siemens">
      <EtcsDmi
        unit={unit}
        driverAid={t.driverAid}
        track={t.track}
        speedSet={drive.speedControlTarget}
        maxSpeed={maxSpeed}
        clockIso={t.world?.localTimeIso}
        message={message}
      />
      <TmsDisplay
        drive={drive}
        values={t.cab?.values}
        unit={unit}
        formationLength={t.loco?.formationLength ?? null}
        clockIso={t.world?.localTimeIso}
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
            state: flag(v.emergencyHold) || flag(v.tractionLocked) || drive.isTractionLocked ? "warn" : "off",
          },
        ]}
      />
    </div>
  );
}
