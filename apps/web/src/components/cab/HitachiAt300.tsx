import { EtcsDmi } from "./EtcsDmi";
import { flag, TmsDisplay, type CabDeskProps } from "./TmsDisplay";

/**
 * Class 800/805 (Hitachi AT300) desk: the ETCS DMI as the speedometer in
 * front of the driver, and the train management screen to its right.
 */
export function HitachiAt300({ t, drive, unit, maxSpeed, message }: CabDeskProps) {
  const v = t.cab?.values ?? {};
  return (
    <div className="desk desk-hitachi">
      <EtcsDmi
        unit={unit}
        driverAid={t.driverAid}
        track={t.track}
        speedSet={drive.speedControlTarget}
        maxSpeed={maxSpeed}
        clockIso={t.world?.localTimeIso}
        message={message}
      />
      {v.displayPowered === false ? (
        <div className="at-screen tms at-off">Display not powered</div>
      ) : (
        <TmsDisplay
          drive={drive}
          values={t.cab?.values}
          unit={unit}
          formationLength={t.loco?.formationLength ?? null}
          clockIso={t.world?.localTimeIso}
          theme="theme-hitachi"
          tiles={[
            { label: flag(v.engineRunning) ? "Diesel" : "Electric", state: "on" },
            { label: "Pantograph", state: flag(v.pantographUp) ? "on" : "off" },
            // Only a fault if the pantograph is up but there's no supply.
            { label: "Line supply", state: flag(v.lineSupply) ? "on" : flag(v.pantographUp) ? "warn" : "off" },
            { label: "Traction lock", state: flag(v.tractionLocked) || drive.isTractionLocked ? "warn" : "off" },
            { label: "DRA", state: flag(v.draSet) ? "warn" : "off" },
            // The flag stays true at line speed on the 801, so only count it when stopped.
            { label: "Brake hold", state: flag(v.brakeHoldSpeedReached) && (drive.speed ?? 0) < 0.5 ? "on" : "off" },
            { label: "Wheelslip", state: drive.isSlipping ? "warn" : "off" },
          ]}
        />
      )}
    </div>
  );
}
