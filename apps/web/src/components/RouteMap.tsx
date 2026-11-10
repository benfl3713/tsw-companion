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
import type { PositionState } from "@tsw/shared";

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
      paint: { "line-color": "#f2b33d", "line-width": 4, "line-opacity": 0.75 },
      layout: { "line-cap": "round", "line-join": "round" },
    },
  ],
};

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
}

export function RouteMap({ position, trailKey, visible }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const arrow = useRef<HTMLDivElement | null>(null);
  const trail = useRef<[number, number][]>([]);
  const heading = useRef(0);
  const [follow, setFollow] = useState(true);
  const [layers, setLayers] = useState(readLayers);

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

    const el = document.createElement("div");
    el.className = "train-marker";
    const inner = document.createElement("div");
    inner.className = "train-arrow";
    el.appendChild(inner);
    arrow.current = inner;
    marker.current = new Marker({ element: el });

    map.current = m;
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
        <button className={`chip ${follow ? "on" : ""}`} onClick={() => setFollow(true)}>
          {follow ? "Following" : "Follow train"}
        </button>
      </div>
      {!position && <div className="map-empty">No position from the game yet.</div>}
    </div>
  );
}
