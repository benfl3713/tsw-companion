# TSW Companion

Companion app for Train Sim World 7: cab-screen replicas, a live route map, an upcoming-track strip and driving data on a tablet or phone, so you can drive with the HUD off.

## Setup

1. In Steam: **Train Sim World 7 > Properties > Launch Options**, add `-HTTPAPI`.
2. Start the game once. It writes `Documents\My Games\TrainSimWorld7\Saved\Config\CommAPIKey.txt`.
3. `npm install`

## Phase 1: API probe

Load into a cab, then run:

```bash
npm run probe
```

The probe checks the connection, saves raw responses and the current loco's control tree to `apps/bridge/dumps/<time>/`, tests whether subscriptions work, and measures read rates. Options: `--key`, `--url`, `--depth 3`, `--seconds 5`, `--no-list`.

## Bridge

Runs on the gaming PC, keeps a connection to the game (waits for it, survives restarts and loco changes) and streams telemetry over WebSocket on port 31280:

```bash
npm start
```

- `ws://<pc-ip>:31280/ws`: a `snapshot` message on connect, then `update` messages with only the sections that changed (see `Telemetry` in `packages/shared`).
- `http://<pc-ip>:31280/telemetry`: current state as JSON.
- `npm run watch`: a live one-line readout with update rate, useful for checking without the web app.

Reads are grouped into three subscriptions: drive values (every game tick, about 30 Hz), signals, limits and position (10 Hz), and track, time and weather (1 Hz).

## Driver panel (web app)

```bash
npm run build   # once, and after UI changes
npm start       # bridge serves the panel; scan the QR code it prints
```

Open `http://<pc-ip>:31280/` on a tablet or phone on the same network. If the tablet can't connect, allow Node.js through Windows Firewall on private networks.

### Full-screen app on iPad

1. Open the address above in **Safari**.
2. Tap **Share**, then **Add to Home Screen**. It appears as **TSW Cab**.
3. Open it from the home screen. It runs full screen with no browser bars and stays on whichever view you left it on.

It's a Progressive Web App: a manifest, home-screen icons (regenerate with `node apps/web/scripts/make-icons.mjs`) and iOS full-screen settings. While it's open the screen is kept awake from your first tap; turn this off in **Settings → This device**. Pages opened in a normal Safari tab get a full-screen button in the top bar instead.

Two features only work over HTTPS or on the PC itself (`localhost`): the offline app shell (`sw.js`) and the Wake Lock API. Over plain LAN HTTP the app still installs and runs full screen, and keep-awake falls back to NoSleep.js, which works on iPad.

For UI work, `npm run dev:web` runs Vite with hot reload on port 5173 and forwards telemetry to the bridge. `npm run demo` runs the bridge on a synthetic looping route (signals, limit changes, platforms) so you can work without the game.

**Recorded signals and limits:** the game only reports what's ahead of you, so the bridge learns the route as you drive. Each signal and limit change from the lookahead gets a position on an odometer integrated from speed. When the train reaches it, the bridge saves the train's own position and heading. That means no calibration between game coordinates and the map. Repeat passes refine the position, and items that drop out of the lookahead early (a different route at a junction) are discarded. Recordings are kept in `apps/bridge/data/recorded.json` (the demo uses `recorded-demo.json`) and appear on the map under **Recorded**.

The **Map** view (switch in the top bar) shows the train's live position and heading with its trail, on OpenStreetMap with optional OpenRailwayMap layers for track, max speed and signals. A compact readout and the Ahead column stay visible so you can drive from the map. The game's position can sit 100–200 m off the real-world track, depending on the route.

The **Cab** view replicates the current loco's own desk displays, full screen, built from live values (the game's own screens can't be streamed). Profiles in `packages/shared/src/profiles.ts` choose the desk and the extra API paths it reads:

- **Class 800/801/802/805/807/810 (Hitachi AT300)**: an ETCS driver display (DMI) as the speedometer, laid out to the ERA DMI specification. It has the permitted-speed band and hook, a distance-to-target bar, a speed-set marker, and needle colours by supervision status. Beside it is the train management screen: status bar, status tiles, traction/brake demand and MR/BP/BC pressures.
- **Class 700/707 (Siemens Desiro City)**: the same DMI, with a train control screen showing AC/DC supply, pantograph, shoes, regenerative braking and brake hold.
- **Class 375/377/379/387 (Electrostar)**, verified on the 377/4:
  - **MITRAC display:** Driver's Menu (doors, DRA, traction interlock, clock), Door Status for the driving vehicle's four doors, and Traction Status.
  - **Instruments:** a black-faced analogue speedometer with a red speed-set pointer, and a brake gauge showing main reservoir (red) and brake cylinder (white) from the simulation.
  - **Controller readout:** the controller's own notch (EB, B3–B1, OFF, P1–P4).
  - **AWS/TPWS and vigilance:** the 377's own interface; vigilance warns when its 60-second timer runs out.
- **Anything else**: an analogue speedometer, brake gauges, ammeter and engine RPM (shown once the loco reports them), plus AWS/TPWS/DSD where fitted.

The **Ahead** strip also sits beside the cab desk. Turn it off in **Settings → Cab displays** for a desk-only view.

The DMI's planning area (speed profile, gradients and red signals ahead) is filled from TSW's lookahead. A real DMI outside ETCS areas leaves it blank, so it can be turned off in Settings.

To try a desk without the game, run `npm run demo -- --loco Class700` (or `Class377`, `Class805`).

To add a loco, run `npm run probe` in its cab, find the values in `apps/bridge/dumps/<time>/current-drivable-actor.txt`, and add a profile.

**Alerts** appear under the top bar in every view:
- AWS, vigilance/DSD, brake demand and wheelslip warnings.
- Overspeed against the current limit.
- **Braking advice** for the next lower limit or red signal: "Brake in …" shortly before the point where service braking (0.45 m/s²) must start, "BRAKE" once past it, and "BRAKE HARD" when more than 0.8 m/s² is needed. Tuning is in `packages/shared/src/braking.ts`.

**Schedule** (button in the top bar) opens a floating panel that stays up while you drive:
- **Calling at:** the service's stops from the game's station list, each with its platform, distance and an estimated arrival (`~08:57`). The estimate comes from your speed, the limits ahead and a standard dwell, so it's a guide and not the timetable. In free roam it lists the platforms ahead instead.
- **Called at:** where you've actually stopped, with arrival and departure on the game clock.
- **Door timeline** at each station: the dwell counts down, then **Close doors** (starting 20 seconds before departure, adjustable under Settings → Doors), then **Locked**, then **Depart**. The same cue shows as a banner in every view, with a station chime if sound is on, and a dot on the Schedule button when the panel is closed. Where the loco reports its doors (the Electrostar does) it knows when they're already shut.

The game doesn't hand over the timetable's scheduled times in free roam, so early/late running only appears if a service provides them. The bridge writes what the game actually sends for each objective to `apps/bridge/data/objective-trace.log`, and AWS/TPWS/vigilance changes to `safety-trace.log`, to check against the cab.

To read the real signals yourself, turn off **Settings → Signals → Show signal aspects**. The Ahead strip, the next-signal card, the map readout and the ETCS planning area then show where signals are but not their aspect, and braking advice stops planning for red signals (which would give them away). Limit braking advice still works.

Tap **Sound off** in the top bar to enable alert tones on the tablet (browsers only allow sound after a tap, so you may need to tap it again after reloading).

On a service, the **Service** card shows the service name, the dwell countdown at stops and door instructions. The API returns timetable times as empty values, so early/late running isn't available.

The **Ahead** column shows the next signals, limit changes and platforms on a log scale (tap the range button for 2 / 5 / 10 km), with the permitted speed profile on the left. The game returns at most 4 signals and 4 limits within 10 km.

## Layout

- `packages/shared`: API response types shared by bridge and web app
- `apps/bridge`: Node service on the gaming PC that talks to the TSW API (`src/tsw/client.ts`)
- `apps/web`: React driver panel for tablets and phones
