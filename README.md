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

Open `http://<pc-ip>:31280/` on a tablet or phone on the same network. Add it to the home screen for fullscreen. If the tablet can't connect, allow Node.js through Windows Firewall on private networks.

For UI work, `npm run dev:web` runs Vite with hot reload on port 5173 and forwards telemetry to the bridge. `npm run demo` runs the bridge on a synthetic looping route (signals, limit changes, platforms) so you can work without the game.

The **Ahead** column shows the next signals, limit changes and platforms on a log scale (tap the range button for 2 / 5 / 10 km), with the permitted speed profile on the left. The game returns at most 4 signals and 4 limits within 10 km.

## Layout

- `packages/shared`: API response types shared by bridge and web app
- `apps/bridge`: Node service on the gaming PC that talks to the TSW API (`src/tsw/client.ts`)
- `apps/web`: React driver panel for tablets and phones
