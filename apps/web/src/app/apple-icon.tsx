import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * iOS home-screen icon. Full-bleed square with no rounded corners of its own —
 * iOS applies its own mask, and a pre-rounded icon ends up double-rounded with
 * dark corners showing through.
 *
 * Rendered with next/og rather than shipping a binary PNG, so the mark stays in
 * one place: change the colour or the letters here and in icon.svg together.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#101723",
          color: "#fafafa",
          fontSize: 84,
          fontWeight: 600,
          letterSpacing: -3,
        }}
      >
        V2
      </div>
    ),
    size,
  );
}
