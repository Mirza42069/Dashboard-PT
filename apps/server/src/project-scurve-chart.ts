import { zlibSync } from "fflate";

export type ProjectCurveChartPoint = {
  planned: number;
  actual: number | null;
  isCurrent: boolean;
};

const WIDTH = 1200;
const HEIGHT = 600;
const PLOT = { left: 82, top: 24, right: 1168, bottom: 548 };

type Color = readonly [number, number, number];

const WHITE: Color = [255, 255, 255];
const GRID: Color = [220, 226, 230];
const AXIS: Color = [92, 105, 112];
const CURRENT: Color = [122, 132, 139];
const PLANNED: Color = [194, 123, 24];
const ACTUAL: Color = [16, 102, 111];

const GLYPHS: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "%": ["101", "001", "010", "100", "101"],
  ".": ["000", "000", "000", "000", "010"],
  "-": ["000", "000", "111", "000", "000"],
  A: ["010", "101", "111", "101", "101"],
  P: ["110", "101", "110", "100", "100"],
};

class Raster {
  readonly pixels = new Uint8Array(WIDTH * HEIGHT * 3);

  constructor() {
    for (let index = 0; index < this.pixels.length; index += 3) {
      this.pixels[index] = WHITE[0];
      this.pixels[index + 1] = WHITE[1];
      this.pixels[index + 2] = WHITE[2];
    }
  }

  pixel(x: number, y: number, color: Color) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || px >= WIDTH || py < 0 || py >= HEIGHT) return;
    const offset = (py * WIDTH + px) * 3;
    this.pixels[offset] = color[0];
    this.pixels[offset + 1] = color[1];
    this.pixels[offset + 2] = color[2];
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Color, width = 1) {
    const distance = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    const steps = Math.max(1, Math.ceil(distance));
    const radius = Math.floor(width / 2);
    for (let step = 0; step <= steps; step += 1) {
      const x = x1 + ((x2 - x1) * step) / steps;
      const y = y1 + ((y2 - y1) * step) / steps;
      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) this.pixel(x + ox, y + oy, color);
      }
    }
  }

  dashedLine(x1: number, y1: number, x2: number, y2: number, color: Color, width = 2) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length === 0) return;
    for (let start = 0; start < length; start += 18) {
      const end = Math.min(start + 10, length);
      this.line(
        x1 + ((x2 - x1) * start) / length,
        y1 + ((y2 - y1) * start) / length,
        x1 + ((x2 - x1) * end) / length,
        y1 + ((y2 - y1) * end) / length,
        color,
        width,
      );
    }
  }

  circle(cx: number, cy: number, radius: number, color: Color) {
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        if (x * x + y * y <= radius * radius) this.pixel(cx + x, cy + y, color);
      }
    }
  }

  text(value: string, x: number, y: number, color: Color, scale = 2) {
    let cursor = x;
    for (const character of value) {
      const glyph = GLYPHS[character];
      if (!glyph) {
        cursor += 4 * scale;
        continue;
      }
      for (let row = 0; row < glyph.length; row += 1) {
        for (let column = 0; column < glyph[row]!.length; column += 1) {
          if (glyph[row]![column] !== "1") continue;
          for (let sy = 0; sy < scale; sy += 1) {
            for (let sx = 0; sx < scale; sx += 1) {
              this.pixel(cursor + column * scale + sx, y + row * scale + sy, color);
            }
          }
        }
      }
      cursor += 4 * scale;
    }
  }
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function xFor(index: number, count: number) {
  if (count <= 1) return PLOT.left;
  return PLOT.left + (index / (count - 1)) * (PLOT.right - PLOT.left);
}

function yFor(value: number) {
  return PLOT.bottom - (clampPercent(value) / 100) * (PLOT.bottom - PLOT.top);
}

function uint32(value: number) {
  return Uint8Array.of(
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  );
}

function concatenate(parts: readonly Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type);
  const content = concatenate([typeBytes, data]);
  return concatenate([uint32(data.length), content, uint32(crc32(content))]);
}

function encodePng(raster: Raster) {
  const stride = WIDTH * 3 + 1;
  const raw = new Uint8Array(stride * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    raw.set(raster.pixels.subarray(y * WIDTH * 3, (y + 1) * WIDTH * 3), y * stride + 1);
  }

  const header = concatenate([
    uint32(WIDTH),
    uint32(HEIGHT),
    Uint8Array.of(8, 2, 0, 0, 0),
  ]);
  return concatenate([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** Renders an export-safe PNG without native canvas dependencies. */
export function renderProjectSCurveChart(points: readonly ProjectCurveChartPoint[]) {
  const raster = new Raster();

  for (let percent = 0; percent <= 100; percent += 20) {
    const y = yFor(percent);
    raster.line(PLOT.left, y, PLOT.right, y, percent === 0 ? AXIS : GRID);
    raster.text(`${percent}%`, 10, y - 5, AXIS, 2);
  }

  raster.line(PLOT.left, PLOT.top, PLOT.left, PLOT.bottom, AXIS);

  const tickEvery = Math.max(1, Math.ceil(points.length / 16));
  points.forEach((point, index) => {
    const x = xFor(index, points.length);
    if (index % tickEvery === 0 || index === points.length - 1) {
      raster.line(x, PLOT.bottom, x, PLOT.bottom + 5, AXIS);
      const label = String(index + 1);
      raster.text(label, x - label.length * 4, PLOT.bottom + 13, AXIS, 2);
    }
    if (point.isCurrent) raster.dashedLine(x, PLOT.top, x, PLOT.bottom, CURRENT);
  });

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    raster.dashedLine(
      xFor(index - 1, points.length),
      yFor(previous.planned),
      xFor(index, points.length),
      yFor(point.planned),
      PLANNED,
      3,
    );
    if (previous.actual !== null && point.actual !== null) {
      raster.line(
        xFor(index - 1, points.length),
        yFor(previous.actual),
        xFor(index, points.length),
        yFor(point.actual),
        ACTUAL,
        4,
      );
    }
  }

  points.forEach((point, index) => {
    if (point.actual !== null) {
      raster.circle(xFor(index, points.length), yFor(point.actual), 4, ACTUAL);
    }
  });

  const plannedLast = points.at(-1);
  if (plannedLast) {
    raster.text(`P ${plannedLast.planned.toFixed(1)}%`, PLOT.right - 92, yFor(plannedLast.planned) - 18, PLANNED, 2);
  }
  const actualIndex = points.findLastIndex((point) => point.actual !== null);
  const actualLast = points[actualIndex];
  if (actualLast?.actual !== null && actualLast?.actual !== undefined) {
    const x = Math.min(PLOT.right - 92, xFor(actualIndex, points.length) + 10);
    raster.text(`A ${actualLast.actual.toFixed(1)}%`, x, yFor(actualLast.actual) + 10, ACTUAL, 2);
  }

  return encodePng(raster);
}
