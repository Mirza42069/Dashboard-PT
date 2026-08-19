import { ImageResponse } from "next/og";

import { BANNER, BOWL } from "@/components/logo";

export const alt = "Fushin construction progress control";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", background: "#101a2b", color: "#fffefa", fontFamily: "sans-serif", padding: "72px" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", opacity: 0.2, backgroundImage: "linear-gradient(#ffffff22 1px,transparent 1px),linear-gradient(90deg,#ffffff22 1px,transparent 1px)", backgroundSize: "64px 64px" }} />
      <div style={{ position: "absolute", width: 680, height: 680, borderRadius: 999, right: -180, top: -280, background: "#2c64e8", opacity: 0.45, filter: "blur(40px)" }} />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg viewBox="0 0 810 810" width={56} height={56}>
            <rect width="810" height="810" rx="176" fill="#5e17eb" />
            <path d={BOWL} fill="#000000" />
            <path d={BANNER} fill="#000000" />
          </svg>
          <span style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-0.02em" }}>Fushin</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 930 }}>
          <div style={{ fontSize: 76, lineHeight: 1.02, letterSpacing: "-0.045em", fontWeight: 600 }}>Control construction progress. Baseline to decision.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 16, color: "#ffffff88" }}>
          <span>BASELINE / PROGRESS / DECISION</span>
          <span>ENGLISH + BAHASA INDONESIA</span>
        </div>
      </div>
    </div>,
    size,
  );
}
