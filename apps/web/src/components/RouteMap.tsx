import { useEffect, useRef, useState } from "react";
import {
  type GeoJSONSource,
  Map as MapLibreMap,
  type MapOptions,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre resolves its worker file at runtime, which the bundler can't see;
// bundle it explicitly and hand over the URL.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { PositionState, RecordedFeature } from "@tsw/shared";
import { limitIn, type SpeedUnit } from "../units";

type StyleSpecification = Exclude<MapOptions["style"], string | undefined>;

setWorkerUrl(workerUrl);

// OpenRailwayMap overlays show real-world railway data, which TSW routes are
// modelled on. Their tiles are for light personal use; keep requests modest.
const ORM_LAYERS = {
  standard: "Track",
  maxspeed: "Max speed",
  signals: "Signals",
} as const;
type OrmLayer = keyof typeof ORM_LAYERS;

const LAYERS_KEY = "tsw.mapLayers";
const TRAIL_MAX_POINTS = 5000;
const TRAIL_MIN_STEP_M = 5;

function ormSource(layer: OrmLayer) {
  return {
    type: "raster" as const,
    tiles: ["a", "b", "c"].map((s) => `https://${s}.tiles.openrailwaymap.org/${layer}/{z}/{x}/{y}.png`),
    tileSize: 256,
    maxzoom: 19,
    attribution: '<a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
  };
}

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    ...Object.fromEntries((Object.keys(ORM_LAYERS) as OrmLayer[]).map((l) => [`orm-${l}`, ormSource(l)])),
    trail: { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } } },
    recorded: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0b0d10" } },
    {
      id: "osm",
      type: "raster",
      source: "osm",
      // Darken the light OSM tiles to sit in the dark UI.
      paint: { "raster-brightness-max": 0.42, "raster-saturation": -0.7, "raster-contrast": 0.1 },
    },
    ...(Object.keys(ORM_LAYERS) as OrmLayer[]).map((l) => ({
      id: `orm-${l}`,
      type: "raster" as const,
      source: `orm-${l}`,
      layout: { visibility: "none" as const },
      paint: { "raster-opacity": 0.9 },
    })),
    {
      id: "trail",
      type: "line",
      source: "trail",
      paint: { "line-color": "#dfdf00", "line-width": 4, "line-opacity": 0.8 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    // Icons are drawn on demand (see drawRecordedIcon), so no sprite or glyph server is needed.
    {
      id: "recorded-signals",
      type: "symbol",
      source: "recorded",
      filter: ["==", ["get", "kind"], "signal"],
      minzoom: 11,
      layout: {
        "icon-image": "rec-signal",
        "icon-rotate": ["get", "bearing"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.5, 16, 1],
      },
    },
    {
      id: "recorded-limits",
      type: "symbol",
      source: "recorded",
      filter: ["==", ["get", "kind"], "limit"],
      minzoom: 11,
      layout: {
        "icon-image": ["concat", "rec-limit-", ["get", "label"]],
        "icon-allow-overlap": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.45, 16, 0.9],
      },
    },
  ],
};

/** Draws the recorded-feature icons the first time the map asks for them. */
function drawRecordedIcon(id: string): ImageData | null {
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  if (id === "rec-signal") {
    // Signal head with an arrow showing the direction it applies to.
    g.fillStyle = "#0b0d10";
    g.strokeStyle = "#e8edf2";
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(14, 6, 20, 36, 6);
    g.fill();
    g.stroke();
    g.fillStyle = "#3ccf7a";
    g.beginPath();
    g.moveTo(24, 12);
    g.lineTo(31, 24);
    g.lineTo(17, 24);
    g.closePath();
    g.fill();
    g.fillStyle = "#ef4b4b";
    g.beginPath();
    g.arc(24, 33, 4, 0, Math.PI * 2);
    g.fill();
  } else if (id.startsWith("rec-limit-")) {
    const label = id.slice("rec-limit-".length);
    g.fillStyle = "#fff";
    g.strokeStyle = "#ef4b4b";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = "#000";
    g.font = `800 ${label.length > 2 ? 15 : 19}px "Segoe UI", system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, size / 2, size / 2 + 1);
  } else {
    return null;
  }
  return g.getImageData(0, 0, size, size);
}

function readLayers(): Set<OrmLayer> {
  try {
    const v = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? "null") as unknown;
    if (Array.isArray(v)) return new Set(v.filter((l): l is OrmLayer => l in ORM_LAYERS));
  } catch {
    // Fall through to the default.
  }
  return new Set<OrmLayer>(["standard"]);
}

/** Approximate metres between two lat/lon points (fine at these scales). */
function metresBetween(a: [number, number], b: [number, number]) {
  const k = 111_320;
  const dx = (b[0] - a[0]) * k * Math.cos((a[1] * Math.PI) / 180);
  const dy = (b[1] - a[1]) * k;
  return Math.hypot(dx, dy);
}

function bearing(a: [number, number], b: [number, number]) {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
  const dy = b[1] - a[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

interface Props {
  position: PositionState | null;
  /** Clears the trail when this changes (e.g. a new loco). */
  trailKey: string | undefined;
  visible: boolean;
  recorded: RecordedFeature[];
  unit: SpeedUnit;
}

const RECORDED_KEY = "tsw.mapRecorded";

function toGeoJson(features: RecordedFeature[], unit: SpeedUnit) {
  return {
    type: "FeatureCollection" as const,
    features: features.map((f) => ({
      type: "Feature" as const,
      properties: { kind: f.kind, bearing: f.bearing, label: f.limit != null ? String(limitIn(f.limit, unit)) : "" },
      geometry: { type: "Point" as const, coordinates: [f.longitude, f.latitude] },
    })),
  };
}

export function RouteMap({ position, trailKey, visible, recorded, unit }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const arrow = useRef<HTMLDivElement | null>(null);
  const trail = useRef<[number, number][]>([]);
  const heading = useRef(0);
  const [follow, setFollow] = useState(true);
  const [layers, setLayers] = useState(readLayers);
  const [showRecorded, setShowRecorded] = useState(() => {
    try {
      return localStorage.getItem(RECORDED_KEY) !== "off";
    } catch {
      return true;
    }
  });

  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    const apply = () => {
      (m.getSource("recorded") as GeoJSONSource | undefined)?.setData(toGeoJson(recorded, unit));
      for (const id of ["recorded-signals", "recorded-limits"]) {
        m.setLayoutProperty(id, "visibility", showRecorded ? "visible" : "none");
      }
    };
    if (m.isStyleLoaded()) apply();
    else m.once("load", apply);
    try {
      localStorage.setItem(RECORDED_KEY, showRecorded ? "on" : "off");
    } catch {
      // Not persisted; fine.
    }
  }, [recorded, unit, showRecorded, mapReady]);

  useEffect(() => {
    if (!container.current) return;
    const m = new MapLibreMap({
      container: container.current,
      style: STYLE,
      center: [-1.5, 52.5],
      zoom: 14,
      attributionControl: { compact: true },
      pitchWithRotate: false,
    });
    m.addControl(new NavigationControl({ showCompass: true, visualizePitch: false }), "bottom-right");
    m.addControl(new ScaleControl({ unit: "imperial" }), "bottom-left");
    // Any drag by the user stops following until they tap the follow button.
    m.on("dragstart", () => setFollow(false));
    m.on("styleimagemissing", (e) => {
      const image = drawRecordedIcon(e.id);
      if (image && !m.hasImage(e.id)) m.addImage(e.id, image);
    });

    const el = document.createElement("div");
    el.className = "train-marker";
    const inner = document.createElement("div");
    inner.className = "train-arrow";
    el.appendChild(inner);
    arrow.current = inner;
    marker.current = new Marker({ element: el });

    map.current = m;
    setMapReady(true);
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // MapLibre can't size itself while hidden.
  useEffect(() => {
    if (visible) map.current?.resize();
  }, [visible]);

  useEffect(() => {
    trail.current = [];
  }, [trailKey]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      for (const l of Object.keys(ORM_LAYERS) as OrmLayer[]) {
        m.setLayoutProperty(`orm-${l}`, "visibility", layers.has(l) ? "visible" : "none");
      }
    };
    if (m.isStyleLoaded()) apply();
    else m.once("load", apply);
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify([...layers]));
    } catch {
      // Not persisted; fine.
    }
  }, [layers]);

  useEffect(() => {
    const m = map.current;
    if (!m || !position) return;
    const here: [number, number] = [position.longitude, position.latitude];
    const t = trail.current;
    const last = t[t.length - 1];
    if (!last || metresBetween(last, here) >= TRAIL_MIN_STEP_M) {
      if (last) heading.current = bearing(last, here);
      t.push(here);
      if (t.length > TRAIL_MAX_POINTS) t.splice(0, t.length - TRAIL_MAX_POINTS);
      (m.getSource("trail") as GeoJSONSource | undefined)?.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: t },
      });
    }

    marker.current?.setLngLat(here);
    if (!marker.current?.getElement().isConnected) marker.current?.addTo(m);
    if (arrow.current) arrow.current.style.transform = `rotate(${heading.current - m.getBearing()}deg)`;

    if (follow && visible) m.easeTo({ center: here, duration: 150, easing: (x: number) => x });
  }, [position, follow, visible]);

  const toggleLayer = (l: OrmLayer) =>
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });

  return (
    <div className="map-wrap">
      <div ref={container} className="map" />
      <div className="map-controls">
        {(Object.keys(ORM_LAYERS) as OrmLayer[]).map((l) => (
          <button key={l} className={`chip ${layers.has(l) ? "on" : ""}`} onClick={() => toggleLayer(l)}>
            {ORM_LAYERS[l]}
          </button>
        ))}
        <button
          className={`chip ${showRecorded ? "on" : ""}`}
          onClick={() => setShowRecorded((v) => !v)}
          title="Signals and limits recorded from the game as you drive"
        >
          Recorded ({recorded.length})
        </button>
        <button className={`chip ${follow ? "on" : ""}`} onClick={() => setFollow(true)}>
          {follow ? "Following" : "Follow train"}
        </button>
      </div>
      {!position && <div className="map-empty">No position from the game yet.</div>}
    </div>
  );
}
