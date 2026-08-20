import Image from "next/image";
import type { CSSProperties } from "react";

import { getShot, type Shot, type ShotFraming, type ShotName } from "@/lib/shots";

import { Lock } from "./icons";

/**
 * A screenshot presented in app-window chrome.
 *
 * The frame is drawn rather than captured so the shot itself stays a clean
 * viewport grab — the title bar, traffic lights, and sync chip belong to the
 * marketing page, not to the product.
 *
 * `priority` is for the hero shot only; it is the LCP element there and should
 * not wait for the lazy-loading observer.
 *
 * A shot that carries a framing rectangle is shown zoomed to that rectangle —
 * see cropStyle below and `.shot-body[data-cropped]` in globals.css.
 */
export function ProductShot({
  name,
  title,
  caption,
  alt,
  priority = false,
  sizes = "(max-width: 1000px) 100vw, 1240px",
}: {
  name: ShotName;
  title: string;
  caption: string;
  alt: string;
  priority?: boolean;
  sizes?: string;
}) {
  const shot = getShot(name);

  return (
    <figure className="shot">
      <div className="shot-frame">
        <div className="window-bar">
          <span className="window-controls" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <strong>{title}</strong>
          {/* Decorative twin of the figcaption below; announcing it twice adds nothing. */}
          <span className="window-sync" aria-hidden>
            <i />
            {caption}
          </span>
        </div>
        <div
          className="shot-body"
          data-cropped={shot?.framing ? "" : undefined}
          style={shot ? cropStyle(shot) : undefined}
        >
          {shot ? (
            <Image
              src={shot.src}
              alt={alt}
              width={shot.width}
              height={shot.height}
              sizes={sizes}
              priority={priority}
              quality={90}
            />
          ) : (
            <ShotPlaceholder caption={caption} />
          )}
        </div>
      </div>
      <figcaption className="shot-caption">{caption}</figcaption>
    </figure>
  );
}

/**
 * Turns a framing rectangle into the four numbers the stylesheet needs.
 *
 * The box takes the *crop's* aspect ratio and the image is scaled by exactly
 * 1/crop on each axis, so the two ratios cancel and the picture is never
 * stretched — only windowed. Offsets are percentages of the box, which is why
 * they are divided by the crop rather than used raw.
 */
function cropStyle(shot: Shot): CSSProperties | undefined {
  const framing = shot.framing;
  if (!framing) return undefined;

  const { left, top, right, bottom }: ShotFraming = framing;
  const width = 1 - left - right;
  const height = 1 - top - bottom;
  if (width <= 0 || height <= 0) return undefined;

  const percent = (value: number) => `${round(value * 100)}%`;

  return {
    "--shot-aspect": `${round(shot.width * width)} / ${round(shot.height * height)}`,
    "--shot-w": percent(1 / width),
    "--shot-h": percent(1 / height),
    "--shot-x": percent(-left / width),
    "--shot-y": percent(-top / height),
  } as CSSProperties;
}

/** Keeps the generated CSS free of float noise like 178.57142857142858%. */
function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Stands in until `bun run shots` has produced the capture. Deliberately looks
 * unfinished — a placeholder that reads as a real screenshot is worse than one
 * that does not.
 */
function ShotPlaceholder({ caption }: { caption: string }) {
  return (
    <div className="shot-placeholder" aria-hidden>
      <Lock />
      <p>{caption}</p>
      <small>bun run shots</small>
    </div>
  );
}
