import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, Vite serves the UI and forwards telemetry to the bridge on 31280.
// In production the bridge serves the built files itself.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/ws": { target: "ws://localhost:31280", ws: true },
      "/telemetry": "http://localhost:31280",
    },
  },
});
