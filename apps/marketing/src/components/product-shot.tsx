import Image from "next/image";

import { getShot, type ShotName } from "@/lib/shots";

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
        <div className="shot-body">
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
