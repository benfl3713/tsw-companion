import { useEffect, useState } from "react";
import NoSleep from "nosleep.js";

// Tablet integration: keeping the screen on, fullscreen, and the service worker.

/** True when launched from the home screen rather than in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

type FullscreenDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => void };

/** The element Fullscreen API, where the browser has it (iPad Safari does, iPhone doesn't). */
export function useFullscreen(): { supported: boolean; active: boolean; toggle: () => void } {
  const doc = document as FullscreenDoc;
  const el = document.documentElement as FullscreenEl;
  const supported = !isStandalone() && Boolean(el.requestFullscreen || el.webkitRequestFullscreen);
  const [active, setActive] = useState(() => Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement));
  useEffect(() => {
    const update = () => setActive(Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, [doc]);
  const toggle = () => {
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      if (doc.exitFullscreen) void doc.exitFullscreen();
      else doc.webkitExitFullscreen?.();
    } else if (el.requestFullscreen) {
      void el.requestFullscreen().catch(() => {});
    } else {
      el.webkitRequestFullscreen?.();
    }
  };
  return { supported, active, toggle };
}

/**
 * Keeps the screen on. Uses the Wake Lock API where available (HTTPS only),
 * otherwise NoSleep's silent looping video, which works over plain LAN HTTP
 * on iPad. Either needs a tap to start, so it arms on the first touch.
 */
export function useKeepAwake(enabled: boolean): boolean {
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const noSleep = new NoSleep();
    let cancelled = false;
    const enable = () => {
      noSleep
        .enable()
        .then(() => !cancelled && setAwake(true))
        .catch(() => !cancelled && setAwake(false));
    };
    // Re-arm after the app comes back to the foreground; iOS drops it on hide.
    const onVisible = () => {
      if (document.visibilityState === "visible") document.addEventListener("pointerdown", enable, { once: true });
    };
    document.addEventListener("pointerdown", enable, { once: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("pointerdown", enable);
      document.removeEventListener("visibilitychange", onVisible);
      noSleep.disable();
      setAwake(false);
    };
  }, [enabled]);
  return awake;
}

/** Offline app shell; browsers only allow this on HTTPS or localhost. */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Not essential; the app works without it.
    });
  });
}
