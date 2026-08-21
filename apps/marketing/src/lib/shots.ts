import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";

/**
 * Product screenshots live in public/product/ and are produced by
 * `bun run shots` (scripts/capture-product-shots.ts), not committed by hand.
 *
 * The page has to render before those files exist — otherwise you cannot work
 * on the layout until the dashboard is running and logged in. So every shot is
 * resolved at request time: present ones render as images, absent ones render
 * as a labelled placeholder frame.
 *
 * Dimensions are read from the PNG header rather than hardcoded, because the
 * capture viewport can change and a stale width/height is a layout shift.
 */

export type ShotName = "dashboard" | "progress" | "import" | "boq";

/**
 * Which part of a capture is actually shown, as the fraction cut from each edge.
 *
 * The captures are whole-app grabs — sidebar, top bar, and a lot of empty
 * canvas — rendered in a column roughly a third of their width, so the subject
 * of each one lands well under half its original scale and its text stops being
 * legible. Framing zooms to the subject in CSS rather than re-cutting the PNGs,
 * which keeps the capture reusable and the numbers below tunable in one place.
 */
export type ShotFraming = { left: number; top: number; right: number; bottom: number };

export type Shot = { src: string; width: number; height: number; framing?: ShotFraming };

/**
 * `dashboard` is deliberately absent: the hero runs at full shell width and is
 * shown whole.
 */
const FRAMING: Partial<Record<ShotName, ShotFraming>> = {
  // The AI import dialog, with some of the project list bleeding around it.
  import: { left: 0.21, top: 0.285, right: 0.21, bottom: 0.29 },
  // "Rencana vs realisasi" — the S-curve card, stopping short of the stat
  // column, whose figures the page already prints beside it.
  progress: { left: 0.19, top: 0.49, right: 0.283, bottom: 0 },
  // The BoQ line items, out to the Bobot column — the weight is what every
  // other figure on this page is derived from, so it stays in frame.
  boq: { left: 0.19, top: 0.565, right: 0.02, bottom: 0 },
};

const PNG_SIGNATURE = "89504e470d0a1a0a";

function shotDir() {
  return join(process.cwd(), "public", "product");
}

/** Reads width/height out of a PNG's IHDR chunk. Returns null if not a PNG. */
function readPngSize(path: string): { width: number; height: number } | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const header = Buffer.alloc(24);
    if (readSync(fd, header, 0, 24, 0) < 24) return null;
    if (header.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) return null;
    if (header.subarray(12, 16).toString("ascii") !== "IHDR") return null;
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function getShot(name: ShotName): Shot | null {
  const path = join(shotDir(), `${name}.png`);
  if (!existsSync(path)) return null;
  const size = readPngSize(path);
  if (!size) return null;
  return { src: `/product/${name}.png`, ...size, framing: FRAMING[name] };
}
