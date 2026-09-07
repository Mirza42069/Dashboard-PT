"use client";

import { useEffect, useState } from "react";

import type ProjectBuildingScene from "./project-building-scene";

export default function ProjectBuildingBanner({ seed }: { seed: string }) {
  const [Scene, setScene] = useState<typeof ProjectBuildingScene | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void import("./project-building-scene").then(
        (module) => {
          if (!cancelled) setScene(() => module.default);
        },
        () => { /* Decoration is optional; retain the static background on failure. */ },
      );
    };
    // Keep Three.js download and initialization out of initial hydration work.
    const idle = typeof window.requestIdleCallback === "function";
    const handle = idle
      ? window.requestIdleCallback(load, { timeout: 2000 })
      : window.setTimeout(load, 1000);
    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="h-full min-h-0 bg-[linear-gradient(115deg,#f0e9ff12,#dff5f51c)]"
    >
      {Scene && <Scene seed={seed} className="h-full min-h-0" />}
    </div>
  );
}
