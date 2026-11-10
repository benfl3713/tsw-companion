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

## Layout

- `packages/shared`: API response types shared by bridge and web app
- `apps/bridge`: Node service on the gaming PC that talks to the TSW API (`src/tsw/client.ts`)
