import { ImageResponse } from "next/og";
import { BRAND_NAME } from "@/components/brand";

export const alt = "Fushin - Construction progress reporting";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#101a2b", color: "#fffefa", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40 }}>
        <span>{BRAND_NAME}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 72, lineHeight: 1.1, fontWeight: 700, maxWidth: 1000 }}>Construction progress, under control.</div>
        <div style={{ fontSize: 28, color: "#c4ccd9" }}>BoQ baselines. S-curves. Daily and weekly reports.</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: "#c4ccd9" }}>
        <span>English + Bahasa Indonesia</span>
        <span>fushin.app</span>
      </div>
    </div>,
    size,
  );
}
