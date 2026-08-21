/**
 * A full sample portfolio: ten projects with real baselines, schedules,
 * progress history, actions and daily reports.
 *
 * Run with: bun run db:seed-portfolio [--dry-run] [--company=SKN] [--user=box@papa.com]
 *
 * Why this exists alongside seed-demo.ts, rather than replacing it:
 * seed-demo produces eight projects of which two have a one-line BoQ and two
 * weekly periods. That is enough to prove the dashboard renders; it is not
 * enough to see an S-curve bend, to rank delay contributors, or to take a
 * screenshot of a Bill of Quantities. This script generates the depth. The two
 * scripts own disjoint code ranges (PRJ-001..008 there, PRJ-101..110 here) and
 * neither touches the other's rows.
 *
 * Idempotent, and narrowly so, exactly like seed-demo: it deletes its own ten
 * codes in the target company and nothing else. Every id it writes is derived
 * from a hash of (company, code, path), so re-running produces the same ids and
 * the activity-log rows — which carry no foreign key and so never cascade — can
 * be cleaned up by id rather than by a prefix match on live data.
 *
 * The target company is resolved from the account the marketing screenshots are
 * captured as, not hardcoded to SKN. Seeding into a tenant that account cannot
 * see would produce ten invisible projects and four unchanged screenshots.
 *
 * Contract dates are relative to the day it runs, so re-running on a later date
 * advances every project. That is the right behaviour for a demo portfolio, but
 * it does move the figures quoted on the marketing page
 * (apps/marketing/src/lib/content.ts). Re-run `bun run shots` after reseeding,
 * and check those numbers still match what the screenshots show.
 */
import { createHash } from "node:crypto";

import { runBatch } from "@DashboardV2/api/lib/batch";
import {
  computeActualCurve,
  computePlannedCurve,
  delayContributors,
  distributionMap,
  scheduleRows,
} from "@DashboardV2/api/lib/curves";
import { generatePeriods } from "@DashboardV2/api/lib/periods";
import { planCells } from "@DashboardV2/api/lib/schedule-plan";
import { db } from "@DashboardV2/db";
import {
  activityLog,
  boqItem,
  boqItemDistribution,
  boqVersion,
  company,
  dailyReport,
  dailyReportDelivery,
  dailyReportEquipment,
  dailyReportManpower,
  progressEntry,
  project,
  projectMember,
  reportingPeriod,
  reportingPeriodEvent,
  ticket,
  user,
} from "@DashboardV2/db/schema";
import type {
  ActionPriority,
  ActionType,
  PeriodStatus,
  PeriodType,
  ProjectStatus,
  TicketStatus,
  WeatherCondition,
} from "@DashboardV2/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

/** The account the marketing capture script signs in as. */
const DEFAULT_CAPTURE_EMAIL = "box@papa.com";

/** Codes this script owns. Nothing outside this list is ever touched. */
const CODES = Array.from({ length: 10 }, (_, index) => `PRJ-${101 + index}`);

// ---------------------------------------------------------------- helpers --

const DAY_MS = 86_400_000;

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

const isDryRun = process.argv.includes("--dry-run");

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

function shiftIso(value: string, days: number): string {
  return new Date(new Date(`${value}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** A timestamp inside the working day of a calendar date. */
function stamp(value: string, hour = 16): Date {
  return new Date(`${value}T${String(hour).padStart(2, "0")}:00:00Z`);
}

/**
 * A UUID derived from its inputs rather than drawn at random.
 *
 * Stable ids are what make the clear step exact: activityLog holds no foreign
 * key to the entity it describes (that is deliberate, see its schema comment),
 * so a re-run has to be able to name the rows it wrote last time.
 */
function uuidFrom(...parts: (string | number)[]): string {
  const hex = createHash("sha256").update(parts.join("::")).digest("hex");
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/** Deterministic PRNG, so the same seed always produces the same portfolio. */
function rng(seed: string): () => number {
  let state = 0;
  for (let index = 0; index < seed.length; index++) {
    state = Math.imul(state ^ seed.charCodeAt(index), 2654435761) >>> 0;
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const dec = (value: number, places: number) => round(value, places).toFixed(places);

/** Splits rows into statement-sized groups; Neon HTTP carries the whole batch in one request. */
function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

const CHUNK = 500;

// ------------------------------------------------------- work breakdowns --

/**
 * One priced line. `from`/`to` are the planning window as fractions of the
 * contract duration, which is what staggers the S-curve: earthworks finish
 * before the facade starts, so the project curve bends instead of running
 * straight. They are mapped onto real period indices once the axis is known.
 */
type LeafSpec = {
  description: string;
  unit: string;
  quantity: number;
  /** Rupiah per unit. */
  rate: number;
  from: number;
  to: number;
};

type SectionSpec = { description: string; leaves: LeafSpec[] };

const leaf = (
  description: string,
  unit: string,
  quantity: number,
  rate: number,
  from: number,
  to: number,
): LeafSpec => ({ description, unit, quantity, rate, from, to });

const BUILDING: SectionSpec[] = [
  {
    description: "Pekerjaan Persiapan",
    leaves: [
      leaf("Mobilisasi dan demobilisasi", "ls", 1, 850_000_000, 0, 0.08),
      leaf("Pagar proyek dan direksi keet", "m2", 620, 385_000, 0, 0.06),
      leaf("Papan nama dan perlengkapan K3", "ls", 1, 240_000_000, 0, 0.1),
    ],
  },
  {
    description: "Pekerjaan Tanah dan Pondasi",
    leaves: [
      leaf("Galian tanah basement", "m3", 18_400, 128_000, 0.04, 0.16),
      leaf("Bore pile diameter 800 mm", "m1", 9_600, 1_450_000, 0.06, 0.24),
      leaf("Pile cap dan tie beam", "m3", 2_150, 3_250_000, 0.14, 0.3),
    ],
  },
  {
    description: "Pekerjaan Struktur Bawah",
    leaves: [
      leaf("Pelat basement dan dinding penahan", "m3", 3_400, 3_100_000, 0.18, 0.34),
      leaf("Kolom struktur lantai basement", "m3", 980, 3_650_000, 0.22, 0.38),
      leaf("Waterproofing basement", "m2", 7_800, 265_000, 0.3, 0.46),
    ],
  },
  {
    description: "Pekerjaan Struktur Atas",
    leaves: [
      leaf("Kolom dan core lift", "m3", 4_250, 3_580_000, 0.32, 0.66),
      leaf("Balok dan pelat lantai tipikal", "m3", 9_800, 3_420_000, 0.36, 0.7),
      leaf("Tangga dan ramp beton", "m3", 640, 3_800_000, 0.48, 0.72),
    ],
  },
  {
    description: "Pekerjaan Arsitektur",
    leaves: [
      leaf("Dinding bata ringan dan plester", "m2", 26_500, 218_000, 0.55, 0.82),
      leaf("Lantai granit dan keramik", "m2", 21_400, 465_000, 0.64, 0.88),
      leaf("Plafon gypsum dan rangka", "m2", 19_800, 285_000, 0.68, 0.9),
      leaf("Kusen, pintu dan jendela aluminium", "m2", 4_600, 1_250_000, 0.7, 0.9),
      leaf("Fasad curtain wall", "m2", 8_900, 2_150_000, 0.6, 0.86),
      leaf("Pengecatan interior dan eksterior", "m2", 38_000, 68_000, 0.74, 0.92),
    ],
  },
  {
    description: "Pekerjaan Mekanikal Elektrikal Plambing",
    leaves: [
      leaf("Instalasi listrik dan panel distribusi", "titik", 3_850, 1_450_000, 0.5, 0.88),
      leaf("Plambing air bersih dan air kotor", "titik", 1_240, 2_100_000, 0.52, 0.88),
      leaf("Tata udara dan ventilasi mekanis", "unit", 268, 42_500_000, 0.58, 0.92),
      leaf("Fire fighting dan sprinkler", "titik", 2_950, 985_000, 0.6, 0.92),
      leaf("Lift penumpang dan lift barang", "unit", 8, 2_850_000_000, 0.56, 0.94),
    ],
  },
  {
    description: "Pekerjaan Luar dan Penyelesaian",
    leaves: [
      leaf("Landscape dan area parkir", "m2", 5_600, 425_000, 0.82, 0.96),
      leaf("Testing commissioning dan serah terima", "ls", 1, 1_250_000_000, 0.9, 1),
    ],
  },
];

const ROAD: SectionSpec[] = [
  {
    description: "Pekerjaan Persiapan",
    leaves: [
      leaf("Mobilisasi alat berat", "ls", 1, 1_650_000_000, 0, 0.08),
      leaf("Pembersihan dan pengupasan lahan", "m2", 148_000, 28_500, 0.02, 0.12),
      leaf("Manajemen dan keselamatan lalu lintas", "bulan", 24, 185_000_000, 0, 1),
    ],
  },
  {
    description: "Pekerjaan Tanah",
    leaves: [
      leaf("Galian tanah biasa", "m3", 386_000, 62_000, 0.06, 0.28),
      leaf("Timbunan pilihan dan pemadatan", "m3", 452_000, 118_000, 0.1, 0.38),
      leaf("Geotekstil dan drainase bawah permukaan", "m2", 96_000, 96_500, 0.18, 0.4),
    ],
  },
  {
    description: "Pekerjaan Perkerasan",
    leaves: [
      leaf("Lapis pondasi agregat kelas B", "m3", 84_000, 385_000, 0.28, 0.52),
      leaf("Lapis pondasi agregat kelas A", "m3", 56_000, 452_000, 0.36, 0.6),
      leaf("Lapis resap pengikat", "liter", 268_000, 18_500, 0.44, 0.64),
      leaf("Laston lapis antara AC-BC", "ton", 62_000, 1_680_000, 0.46, 0.7),
      leaf("Laston lapis aus AC-WC", "ton", 38_500, 1_820_000, 0.56, 0.78),
    ],
  },
  {
    description: "Pekerjaan Struktur",
    leaves: [
      leaf("Box culvert dan gorong-gorong", "m1", 2_480, 6_850_000, 0.2, 0.48),
      leaf("Dinding penahan tanah", "m3", 8_600, 4_250_000, 0.24, 0.56),
      leaf("Jembatan penyeberangan orang", "unit", 6, 4_850_000_000, 0.34, 0.66),
    ],
  },
  {
    description: "Drainase dan Perlengkapan Jalan",
    leaves: [
      leaf("Saluran beton pracetak", "m1", 24_600, 985_000, 0.5, 0.78),
      leaf("Marka jalan termoplastik", "m2", 18_400, 285_000, 0.7, 0.9),
      leaf("Rambu dan guardrail", "m1", 9_800, 1_450_000, 0.68, 0.9),
      leaf("Penerangan jalan umum", "titik", 620, 18_500_000, 0.62, 0.88),
    ],
  },
  {
    description: "Penyelesaian",
    leaves: [
      leaf("Landscape median dan lereng", "m2", 42_000, 68_500, 0.86, 0.96),
      leaf("Uji laik fungsi dan serah terima", "ls", 1, 1_850_000_000, 0.92, 1),
    ],
  },
];

const INDUSTRIAL: SectionSpec[] = [
  {
    description: "Pekerjaan Persiapan",
    leaves: [
      leaf("Mobilisasi dan fasilitas sementara", "ls", 1, 620_000_000, 0, 0.08),
      leaf("Land clearing dan cut and fill", "m3", 96_000, 78_000, 0.02, 0.18),
    ],
  },
  {
    description: "Pekerjaan Pondasi",
    leaves: [
      leaf("Perbaikan tanah dengan stone column", "m1", 28_000, 285_000, 0.08, 0.22),
      leaf("Tiang pancang beton pratekan", "m1", 12_400, 685_000, 0.1, 0.26),
      leaf("Pile cap dan sloof", "m3", 1_850, 3_150_000, 0.18, 0.34),
    ],
  },
  {
    description: "Pekerjaan Struktur",
    leaves: [
      leaf("Kolom baja WF dan base plate", "kg", 486_000, 32_500, 0.26, 0.48),
      leaf("Rangka atap baja dan gording", "kg", 624_000, 28_500, 0.34, 0.56),
      leaf("Lantai beton heavy duty", "m2", 32_000, 585_000, 0.4, 0.62),
    ],
  },
  {
    description: "Arsitektur dan Penutup",
    leaves: [
      leaf("Dinding panel beton pracetak", "m2", 14_600, 685_000, 0.48, 0.72),
      leaf("Atap dan dinding metal sheet", "m2", 38_500, 285_000, 0.52, 0.78),
      leaf("Kanopi dan skylight", "m2", 4_200, 685_000, 0.58, 0.8),
      leaf("Pintu dozen dan loading dock", "unit", 42, 185_000_000, 0.62, 0.84),
    ],
  },
  {
    description: "Utilitas dan Mekanikal Elektrikal",
    leaves: [
      leaf("Instalasi listrik dan genset", "ls", 1, 8_650_000_000, 0.44, 0.82),
      leaf("Fire hydrant dan sprinkler gudang", "titik", 1_450, 1_250_000, 0.54, 0.86),
      leaf("Plambing dan pengolahan air limbah", "ls", 1, 3_250_000_000, 0.58, 0.88),
      leaf("Sistem ventilasi dan exhaust", "unit", 86, 28_500_000, 0.64, 0.9),
      leaf("Jaringan data dan sistem keamanan", "titik", 680, 2_450_000, 0.66, 0.9),
    ],
  },
  {
    description: "Pekerjaan Luar",
    leaves: [
      leaf("Perkerasan yard dan jalan akses", "m2", 42_000, 385_000, 0.72, 0.92),
      leaf("Pagar keliling dan pos jaga", "m1", 2_400, 1_850_000, 0.78, 0.94),
      leaf("Testing dan serah terima", "ls", 1, 850_000_000, 0.9, 1),
    ],
  },
];

const REFURB: SectionSpec[] = [
  {
    description: "Persiapan dan Pembongkaran",
    leaves: [
      leaf("Survey dan gambar asbuilt eksisting", "ls", 1, 285_000_000, 0, 0.1),
      leaf("Pembongkaran finishing eksisting", "m2", 14_500, 125_000, 0, 0.16),
      leaf("Pengamanan area dan proteksi", "ls", 1, 385_000_000, 0, 0.12),
      leaf("Pembuangan puing", "m3", 3_800, 185_000, 0.04, 0.22),
    ],
  },
  {
    description: "Perbaikan Struktur",
    leaves: [
      leaf("Perkuatan balok dan kolom", "m3", 420, 6_850_000, 0.14, 0.38),
      leaf("Perbaikan pelat lantai", "m2", 3_600, 685_000, 0.2, 0.44),
    ],
  },
  {
    description: "Pekerjaan Arsitektur",
    leaves: [
      leaf("Dinding partisi gypsum", "m2", 9_800, 385_000, 0.34, 0.62),
      leaf("Lantai vinil dan homogeneous tile", "m2", 13_400, 585_000, 0.44, 0.72),
      leaf("Plafon akustik dan rangka", "m2", 12_600, 325_000, 0.48, 0.74),
      leaf("Kusen dan daun pintu", "unit", 386, 8_500_000, 0.54, 0.78),
      leaf("Kaca dan partisi frameless", "m2", 2_400, 1_850_000, 0.58, 0.78),
      leaf("Pengecatan menyeluruh", "m2", 28_400, 72_000, 0.62, 0.8),
    ],
  },
  {
    description: "Mekanikal Elektrikal",
    leaves: [
      leaf("Rewiring listrik dan panel", "titik", 2_150, 1_285_000, 0.4, 0.76),
      leaf("Tata udara VRV", "unit", 148, 38_500_000, 0.48, 0.84),
      leaf("Plambing toilet dan pantry", "titik", 420, 2_450_000, 0.52, 0.82),
      leaf("Fire alarm dan tata suara", "titik", 980, 985_000, 0.58, 0.88),
      leaf("Jaringan data dan CCTV", "titik", 860, 1_650_000, 0.6, 0.86),
    ],
  },
  {
    description: "Penyelesaian",
    leaves: [
      leaf("Furnitur lepas dan signage", "ls", 1, 2_650_000_000, 0.78, 0.94),
      leaf("Pembersihan akhir", "m2", 14_500, 42_000, 0.88, 0.98),
      leaf("Testing commissioning", "ls", 1, 485_000_000, 0.9, 1),
    ],
  },
];

const PLANT: SectionSpec[] = [
  {
    description: "Pekerjaan Persiapan",
    leaves: [
      leaf("Mobilisasi dan direksi keet", "ls", 1, 785_000_000, 0, 0.08),
      leaf("Dewatering dan galian tanah", "m3", 64_000, 145_000, 0.02, 0.18),
    ],
  },
  {
    description: "Struktur Sipil",
    leaves: [
      leaf("Bak pengendap dan clarifier beton", "m3", 6_400, 4_250_000, 0.1, 0.34),
      leaf("Bak ekualisasi dan pengolah lumpur", "m3", 2_400, 4_150_000, 0.14, 0.38),
      leaf("Bangunan filter dan reservoir", "m3", 4_850, 4_650_000, 0.18, 0.42),
      leaf("Rumah pompa dan gedung operasi", "m2", 2_600, 6_850_000, 0.24, 0.48),
    ],
  },
  {
    description: "Pekerjaan Perpipaan",
    leaves: [
      leaf("Pipa HDPE diameter 600 mm", "m1", 8_400, 2_850_000, 0.3, 0.58),
      leaf("Pipa transmisi ke reservoir", "m1", 12_600, 1_850_000, 0.34, 0.62),
      leaf("Pipa baja dan fitting internal", "kg", 186_000, 48_500, 0.36, 0.64),
      leaf("Valve, meter dan aksesoris", "unit", 264, 68_500_000, 0.46, 0.72),
    ],
  },
  {
    description: "Mekanikal dan Elektrikal",
    leaves: [
      leaf("Pompa intake dan distribusi", "unit", 18, 685_000_000, 0.44, 0.74),
      leaf("Blower dan unit dosing kimia", "unit", 24, 285_000_000, 0.5, 0.78),
      leaf("Panel MCC dan kabel daya", "ls", 1, 9_850_000_000, 0.52, 0.82),
      leaf("Genset dan panel darurat", "unit", 4, 1_850_000_000, 0.56, 0.8),
      leaf("SCADA dan instrumentasi", "ls", 1, 6_450_000_000, 0.6, 0.86),
    ],
  },
  {
    description: "Penyelesaian",
    leaves: [
      leaf("Jalan operasi dan pagar", "m2", 9_600, 385_000, 0.78, 0.92),
      leaf("Landscape dan drainase tapak", "m2", 6_800, 285_000, 0.8, 0.94),
      leaf("Commissioning dan uji kualitas air", "ls", 1, 2_850_000_000, 0.86, 1),
    ],
  },
];

const BRIDGE: SectionSpec[] = [
  {
    description: "Pekerjaan Persiapan",
    leaves: [
      leaf("Mobilisasi ponton dan alat berat", "ls", 1, 2_450_000_000, 0, 0.1),
      leaf("Pengalihan arus dan jembatan sementara", "ls", 1, 3_850_000_000, 0.02, 0.16),
    ],
  },
  {
    description: "Pekerjaan Pondasi",
    leaves: [
      leaf("Sheet pile dan cofferdam", "m2", 6_400, 1_450_000, 0.12, 0.32),
      leaf("Bore pile diameter 1200 mm", "m1", 4_800, 4_850_000, 0.1, 0.3),
      leaf("Pile cap pilar", "m3", 3_200, 4_250_000, 0.22, 0.4),
    ],
  },
  {
    description: "Struktur Bawah",
    leaves: [
      leaf("Pilar dan kepala jembatan", "m3", 4_600, 5_650_000, 0.32, 0.56),
      leaf("Abutment dan wing wall", "m3", 2_850, 5_250_000, 0.36, 0.62),
      leaf("Perbaikan tanah oprit", "m3", 48_000, 148_000, 0.34, 0.58),
    ],
  },
  {
    description: "Struktur Atas",
    leaves: [
      leaf("Girder beton pratekan tipe I", "unit", 96, 685_000_000, 0.52, 0.76),
      leaf("Erection girder dan diafragma", "unit", 96, 185_000_000, 0.6, 0.8),
      leaf("Pelat lantai jembatan", "m3", 2_400, 4_850_000, 0.66, 0.86),
      leaf("Deck slab dan trotoar", "m2", 4_800, 1_650_000, 0.7, 0.88),
    ],
  },
  {
    description: "Bangunan Pelengkap",
    leaves: [
      leaf("Expansion joint dan bearing pad", "unit", 184, 42_500_000, 0.74, 0.88),
      leaf("Railing dan parapet", "m1", 2_600, 2_850_000, 0.78, 0.92),
      leaf("Perkerasan aspal jembatan", "ton", 4_200, 1_850_000, 0.82, 0.94),
      leaf("Penerangan dan rambu jembatan", "titik", 148, 18_500_000, 0.8, 0.92),
    ],
  },
  {
    description: "Penyelesaian",
    leaves: [
      leaf("Uji beban dan sertifikasi", "ls", 1, 1_650_000_000, 0.88, 1),
      leaf("Pembongkaran fasilitas sementara", "ls", 1, 985_000_000, 0.92, 1),
    ],
  },
];

// ----------------------------------------------------------- blueprints --

type Blueprint = {
  code: string;
  name: string;
  client: string;
  location: string;
  status: ProjectStatus;
  periodType: PeriodType;
  /** Contract dates, in days relative to today. */
  start: number;
  end: number;
  /**
   * How current the reporting is: the share of the periods that have already
   * elapsed which hold readings. 1 means reported up to the latest closed
   * period, 0.55 means the site stopped filing months ago, 0 means never.
   *
   * How far along the *work* is comes from the contract dates instead. Mixing
   * the two is what put three data dates in the future on the first run: a
   * fraction of the whole schedule overshoots today whenever a project runs
   * well past it.
   */
  reportedThrough: number;
  /** Actual over planned at the data date. 1 is on plan, 0.72 is well behind. */
  performance: number;
  /** Quantities are scaled so the portfolio holds contracts of different sizes. */
  scale: number;
  sections: SectionSpec[];
  /** Whether this project gets a run of daily reports. */
  dailyReports?: boolean;
};

/**
 * Ten projects chosen so that every state the dashboard can show is present:
 * ahead, on plan, drifting, badly behind, stalled, finished, and not started.
 * A portfolio where everything is fine tests nothing and screenshots badly.
 *
 * Clients and project names are invented. They are meant to read like real
 * Indonesian construction work, which is what the product is for, without
 * naming an actual firm.
 */
const BLUEPRINTS: Blueprint[] = [
  {
    code: "PRJ-101",
    name: "Menara Perkantoran Cakrawala",
    client: "PT Graha Cakrawala Sejahtera",
    location: "Jakarta Selatan",
    status: "active",
    periodType: "monthly",
    start: -420,
    end: 240,
    reportedThrough: 1,
    performance: 0.93,
    scale: 1,
    sections: BUILDING,
  },
  {
    code: "PRJ-102",
    name: "Jalan Tol Ruas Sindanglaya - Cikupa Seksi 3",
    client: "PT Jalan Nusantara Sarana",
    location: "Banten",
    status: "active",
    periodType: "weekly",
    start: -280,
    end: 180,
    reportedThrough: 1,
    performance: 1,
    scale: 1,
    sections: ROAD,
    dailyReports: true,
  },
  {
    code: "PRJ-103",
    name: "Rumah Sakit Umum Daerah Tirta Medika",
    client: "Dinas Kesehatan Provinsi",
    location: "Semarang",
    status: "active",
    periodType: "monthly",
    start: -330,
    end: 210,
    reportedThrough: 0.94,
    performance: 1.07,
    scale: 0.72,
    sections: BUILDING,
  },
  {
    code: "PRJ-104",
    name: "Gudang Distribusi Regional Cikarang",
    client: "PT Logistik Andalan Prima",
    location: "Bekasi",
    status: "active",
    periodType: "weekly",
    start: -210,
    end: 120,
    reportedThrough: 1,
    performance: 0.71,
    scale: 0.85,
    sections: INDUSTRIAL,
    dailyReports: true,
  },
  {
    code: "PRJ-105",
    name: "Renovasi SMA Negeri 4 Harapan",
    client: "Dinas Pendidikan Kota",
    location: "Bandung",
    status: "completed",
    periodType: "weekly",
    start: -300,
    end: -30,
    reportedThrough: 1,
    performance: 1,
    scale: 0.45,
    sections: REFURB,
  },
  {
    code: "PRJ-106",
    name: "Instalasi Pengolahan Air Minum Kaligawe",
    client: "Perumda Air Minum Tirta Kencana",
    location: "Semarang",
    status: "planning",
    periodType: "monthly",
    start: 45,
    end: 640,
    reportedThrough: 0,
    performance: 1,
    scale: 1,
    sections: PLANT,
  },
  {
    code: "PRJ-107",
    name: "Apartemen Puncak Rawamangun Tower B",
    client: "PT Bumi Rawamangun Permai",
    location: "Jakarta Timur",
    status: "active",
    periodType: "weekly",
    start: -250,
    end: 290,
    reportedThrough: 1,
    performance: 0.98,
    scale: 0.58,
    sections: BUILDING,
    dailyReports: true,
  },
  {
    code: "PRJ-108",
    name: "Jembatan Sungai Belitang",
    client: "Balai Pelaksanaan Jalan Wilayah III",
    location: "Sumatera Selatan",
    status: "on_hold",
    periodType: "biweekly",
    start: -320,
    end: 200,
    reportedThrough: 0.55,
    performance: 0.82,
    scale: 1,
    sections: BRIDGE,
  },
  {
    code: "PRJ-109",
    name: "Fit Out Pusat Perbelanjaan Grand Melati",
    client: "PT Ritel Melati Nusantara",
    location: "Surabaya",
    status: "active",
    periodType: "weekly",
    start: -170,
    end: 45,
    reportedThrough: 1,
    performance: 0.96,
    scale: 0.95,
    sections: REFURB,
    dailyReports: true,
  },
  {
    code: "PRJ-110",
    name: "Gardu Induk 150 kV Sukamaju",
    client: "PT Energi Transmisi Nasional",
    location: "Karawang",
    status: "active",
    periodType: "monthly",
    start: -120,
    end: 420,
    reportedThrough: 0.9,
    performance: 1.02,
    scale: 0.62,
    sections: INDUSTRIAL,
  },
];

/** Actions, drawn from so each project gets a different mix of the same shapes. */
const ACTION_POOL: {
  title: string;
  description: string;
  type: ActionType;
  priority: ActionPriority;
}[] = [
  {
    title: "Rembesan air pada dinding basement",
    description: "Periksa dinding sisi barat dan pastikan sumber rembesan sebelum finishing dimulai.",
    type: "issue",
    priority: "high",
  },
  {
    title: "Klarifikasi detail sambungan balok kolom",
    description: "Gambar struktur dan gambar arsitektur berbeda pada as C-5. Mohon konfirmasi detail yang dipakai.",
    type: "rfi",
    priority: "medium",
  },
  {
    title: "Pekerja tanpa body harness di area ketinggian",
    description: "Ditemukan pada inspeksi pagi di lantai 7. Toolbox meeting ulang dan penyediaan APD tambahan.",
    type: "safety",
    priority: "critical",
  },
  {
    title: "Hasil uji beton umur 28 hari di bawah target",
    description: "Sampel dari pengecoran zona 2 mencapai 26,4 MPa dari target 30 MPa. Perlu uji ulang core drill.",
    type: "quality",
    priority: "high",
  },
  {
    title: "Keterlambatan pengiriman material fasad",
    description: "Supplier memundurkan jadwal dua minggu. Dampak pada lintasan kritis perlu dihitung ulang.",
    type: "delay",
    priority: "high",
  },
  {
    title: "Daftar cacat mutu area lobi",
    description: "Perapian nat keramik dan touch up cat pada dinding lobi utama sebelum serah terima.",
    type: "punch",
    priority: "low",
  },
  {
    title: "Akses jalan proyek rusak akibat hujan",
    description: "Jalan masuk sisi utara berlubang dan menghambat truk mixer. Perlu perbaikan segera.",
    type: "general",
    priority: "medium",
  },
  {
    title: "Perbedaan volume galian terhadap kontrak",
    description: "Volume aktual galian melebihi kontrak sekitar 8%. Ajukan justifikasi teknis dan pekerjaan tambah.",
    type: "issue",
    priority: "medium",
  },
];

const TRADES = [
  "Tukang besi",
  "Tukang batu",
  "Operator alat berat",
  "Tukang kayu dan bekisting",
  "Instalatur mekanikal elektrikal",
  "Helper umum",
] as const;

const EQUIPMENT = [
  "Excavator 20 ton",
  "Tower crane",
  "Concrete pump",
  "Truk mixer",
  "Vibro roller",
  "Genset 250 kVA",
] as const;

const MATERIALS: { material: string; unit: string; supplier: string }[] = [
  { material: "Beton ready mix K-350", unit: "m3", supplier: "PT Beton Sarana Jaya" },
  { material: "Besi beton ulir D16", unit: "kg", supplier: "PT Baja Prima Mandiri" },
  { material: "Bata ringan", unit: "m3", supplier: "PT Material Andalan" },
  { material: "Semen PCC 50 kg", unit: "sak", supplier: "PT Semen Nusantara Niaga" },
  { material: "Agregat kasar 2/3", unit: "m3", supplier: "CV Tambang Sejahtera" },
];

const WEATHER: WeatherCondition[] = [
  "clear",
  "cloudy",
  "light_rain",
  "cloudy",
  "heavy_rain",
  "clear",
];

// -------------------------------------------------------------- building --

type Ctx = {
  companyId: string;
  /** Who prepares and records. The account the screenshots are captured as. */
  actorId: string;
  actorName: string;
  /**
   * Who reviews, approves and locks.
   *
   * Deliberately a different account where one exists: progress:review and
   * progress:lock are not granted to role=user (see lib/permissions.ts), so
   * stamping the capture account as its own approver would depict a state the
   * application itself would refuse to create.
   */
  reviewerId: string;
  reviewerName: string;
};

type Built = {
  blueprint: Blueprint;
  projectId: string;
  versionId: string;
  ticketIds: string[];
  rows: {
    projects: (typeof project.$inferInsert)[];
    members: (typeof projectMember.$inferInsert)[];
    periods: (typeof reportingPeriod.$inferInsert)[];
    periodEvents: (typeof reportingPeriodEvent.$inferInsert)[];
    versions: (typeof boqVersion.$inferInsert)[];
    sections: (typeof boqItem.$inferInsert)[];
    leaves: (typeof boqItem.$inferInsert)[];
    distribution: (typeof boqItemDistribution.$inferInsert)[];
    progress: (typeof progressEntry.$inferInsert)[];
    tickets: (typeof ticket.$inferInsert)[];
    dailyReports: (typeof dailyReport.$inferInsert)[];
    manpower: (typeof dailyReportManpower.$inferInsert)[];
    equipment: (typeof dailyReportEquipment.$inferInsert)[];
    deliveries: (typeof dailyReportDelivery.$inferInsert)[];
    activity: (typeof activityLog.$inferInsert)[];
  };
  summary: {
    periods: number;
    sections: number;
    leaves: number;
    contractValue: number;
    plannedPct: number | null;
    actualPct: number | null;
    dataDate: string | null;
    worstLine: string | null;
    worstSlip: number | null;
  };
};

function buildProject(blueprint: Blueprint, ctx: Ctx, order: number): Built {
  const random = rng(`${ctx.companyId}:${blueprint.code}`);
  const projectId = uuidFrom(ctx.companyId, blueprint.code);
  const versionId = uuidFrom(projectId, "boq-version");
  const startDate = isoDate(blueprint.start);
  const endDate = isoDate(blueprint.end);
  /**
   * When the record was opened, as opposed to when the work starts. A project
   * still in planning has a start date in the future, and stamping its row as
   * created then would put a timestamp ahead of now on every audit line it has.
   */
  const openedDate = startDate < isoDate(-2) ? startDate : isoDate(-2);

  // --- the time axis, generated the way schedule.generatePeriods generates it.
  const generated = generatePeriods(startDate, endDate, blueprint.periodType);
  const periodCount = generated.length;
  const periodIds = generated.map((period) => uuidFrom(projectId, "period", period.periodIndex));
  const periodIndexes = generated.map((period) => period.periodIndex);

  // Nothing can be reported for a period that has not finished yet.
  const today = isoDate(0);
  const elapsed = generated.filter((period) => period.endDate <= today).length;
  const dataIndex =
    blueprint.reportedThrough <= 0 || elapsed === 0
      ? 0
      : clamp(Math.round(elapsed * blueprint.reportedThrough), 1, elapsed);

  /** A badly slipping report is one a reviewer sent back, not one nobody opened. */
  const currentStatus: PeriodStatus =
    blueprint.status === "completed"
      ? "locked"
      : blueprint.performance < 0.8
        ? "returned"
        : "submitted";

  const periods: (typeof reportingPeriod.$inferInsert)[] = [];
  const periodEvents: (typeof reportingPeriodEvent.$inferInsert)[] = [];

  for (const [position, period] of generated.entries()) {
    const id = periodIds[position]!;
    const status: PeriodStatus =
      dataIndex === 0 || period.periodIndex > dataIndex
        ? "open"
        : period.periodIndex < dataIndex
          ? "locked"
          : currentStatus;

    const submitted = stamp(period.endDate, 17);
    const reviewed = new Date(submitted.getTime() + DAY_MS);
    const approved = new Date(submitted.getTime() + 2 * DAY_MS);
    const locked = new Date(submitted.getTime() + 3 * DAY_MS);

    periods.push({
      id,
      projectId,
      periodIndex: period.periodIndex,
      label: period.label,
      startDate: period.startDate,
      endDate: period.endDate,
      status,
      ...(status === "locked"
        ? {
            submittedById: ctx.actorId,
            submittedAt: submitted,
            reviewedById: ctx.reviewerId,
            reviewedAt: reviewed,
            approvedById: ctx.reviewerId,
            approvedAt: approved,
            lockedById: ctx.reviewerId,
            lockedAt: locked,
          }
        : {}),
      ...(status === "submitted" ? { submittedById: ctx.actorId, submittedAt: submitted } : {}),
      ...(status === "returned"
        ? {
            submittedById: ctx.actorId,
            submittedAt: submitted,
            returnReason:
              "Realisasi beberapa lini tidak cocok dengan catatan lapangan. Mohon dicek ulang sebelum diajukan kembali.",
          }
        : {}),
    });

    // How it got there. Only a closed period has the full chain behind it.
    const chain: [PeriodStatus, PeriodStatus, Date][] =
      status === "locked"
        ? [
            ["open", "draft", submitted],
            ["draft", "submitted", submitted],
            ["submitted", "reviewed", reviewed],
            ["reviewed", "approved", approved],
            ["approved", "locked", locked],
          ]
        : status === "submitted"
          ? [
              ["open", "draft", submitted],
              ["draft", "submitted", submitted],
            ]
          : status === "returned"
            ? [
                ["open", "draft", submitted],
                ["draft", "submitted", submitted],
                ["submitted", "returned", reviewed],
              ]
            : [];

    for (const [index, entry] of chain.entries()) {
      const [fromStatus, toStatus, at] = entry;
      // Preparing is the site team; judging is the supervisor.
      const supervised =
        toStatus === "reviewed" ||
        toStatus === "approved" ||
        toStatus === "locked" ||
        toStatus === "returned";
      periodEvents.push({
        id: uuidFrom(id, "event", index),
        periodId: id,
        fromStatus,
        toStatus,
        actorId: supervised ? ctx.reviewerId : ctx.actorId,
        actorName: supervised ? ctx.reviewerName : ctx.actorName,
        comment:
          toStatus === "returned"
            ? "Deviasi kumulatif melewati ambang. Lampirkan justifikasi keterlambatan."
            : null,
        createdAt: at,
      });
    }
  }

  // --- the priced work breakdown.
  const sections: (typeof boqItem.$inferInsert)[] = [];
  const leafRows: (typeof boqItem.$inferInsert)[] = [];
  const leafMeta: { id: string; spec: LeafSpec; quantity: number; value: number }[] = [];
  let sortOrder = 0;

  for (const [sectionIndex, section] of blueprint.sections.entries()) {
    const sectionId = uuidFrom(projectId, "section", sectionIndex);
    sections.push({
      id: sectionId,
      boqVersionId: versionId,
      lineageId: uuidFrom(projectId, "section-lineage", sectionIndex),
      parentId: null,
      code: String(sectionIndex + 1),
      description: section.description,
      weight: "0",
      weightSource: "derived",
      sortOrder: sortOrder++,
    });

    for (const [leafIndex, spec] of section.leaves.entries()) {
      // A lump sum is one unit of itself, so the contract size has to move the
      // rate rather than the quantity.
      const lumpSum = spec.unit === "ls";
      const quantity = lumpSum ? spec.quantity : round(spec.quantity * blueprint.scale, 4);
      const rate = lumpSum ? round(spec.rate * blueprint.scale, 4) : spec.rate;
      const leafId = uuidFrom(projectId, "leaf", sectionIndex, leafIndex);

      const startIndex = clamp(1 + Math.floor(spec.from * (periodCount - 1)), 1, periodCount);
      const finishIndex = clamp(
        1 + Math.ceil(spec.to * (periodCount - 1)),
        startIndex,
        periodCount,
      );

      leafMeta.push({ id: leafId, spec, quantity, value: quantity * rate });
      leafRows.push({
        id: leafId,
        boqVersionId: versionId,
        lineageId: uuidFrom(projectId, "leaf-lineage", sectionIndex, leafIndex),
        parentId: sectionId,
        code: `${sectionIndex + 1}.${leafIndex + 1}`,
        description: spec.description,
        unit: spec.unit,
        quantity: dec(quantity, 4),
        unitRate: dec(rate, 4),
        // Filled in below, once the contract total is known.
        weight: "0",
        weightSource: "derived",
        distribution: "linear",
        progressMode: lumpSum ? "by_percent" : "by_quantity",
        plannedStartPeriodIndex: startIndex,
        plannedFinishPeriodIndex: finishIndex,
        sortOrder: sortOrder++,
      });
    }
  }

  /*
   * Weight is the value share to six places, with the rounding remainder pushed
   * onto the last line. The total has to be exactly 100: boq.activate compares
   * the sum against 100 and float dust is enough to fail it.
   */
  const contractValue = leafMeta.reduce((total, item) => total + item.value, 0);
  const weights = leafMeta.map((item) => round((item.value / contractValue) * 100, 6));
  const remainder = round(100 - weights.reduce((total, value) => total + value, 0), 6);
  weights[weights.length - 1] = round(weights[weights.length - 1]! + remainder, 6);
  for (const [index, row] of leafRows.entries()) row.weight = dec(weights[index]!, 6);

  // --- planned distribution, and the cumulative planned line per leaf.
  const distribution: (typeof boqItemDistribution.$inferInsert)[] = [];
  /** plannedCumulative[leafIndex][periodIndex] — 0..100 of that leaf. */
  const plannedCumulative: number[][] = [];

  for (const [index, row] of leafRows.entries()) {
    const cells = planCells(periodIndexes, {
      startIndex: row.plannedStartPeriodIndex!,
      finishIndex: row.plannedFinishPeriodIndex!,
    });

    let running = 0;
    const cumulative: number[] = [0];
    for (const cell of cells) {
      running = round(running + cell.plannedPct, 6);
      cumulative[cell.periodIndex] = running;
      // A zero cell means "nothing planned here" and is not stored; see the
      // boqItemDistribution schema comment.
      if (cell.plannedPct <= 0) continue;
      distribution.push({
        id: uuidFrom(row.id!, "cell", cell.periodIndex),
        boqItemId: row.id!,
        periodId: periodIds[cell.periodIndex - 1]!,
        plannedPct: dec(cell.plannedPct, 6),
      });
    }
    plannedCumulative[index] = cumulative;
  }

  // --- actual progress.
  const progress: (typeof progressEntry.$inferInsert)[] = [];

  /*
   * Two knobs shape the actual line. `drift` walks the whole project from on
   * plan at the start to its performance figure at the data date, because a job
   * does not begin 30% behind — it gets there. `spread` scatters the lines
   * around that, and widens as performance falls, so a slipping project has a
   * few lines carrying the slip rather than every line being uniformly late.
   * That is what makes delayContributors say something.
   */
  const spread = 0.05 + (1 - Math.min(1, blueprint.performance)) * 0.6;
  const freezeIndex =
    blueprint.status === "on_hold" ? clamp(Math.round(dataIndex * 0.72), 1, dataIndex) : dataIndex;

  for (const [index, row] of leafRows.entries()) {
    const factor = 1 + (random() - 0.5) * 2 * spread;
    const cumulative = plannedCumulative[index]!;
    let previous = 0;

    for (let periodIndex = 1; periodIndex <= dataIndex; periodIndex++) {
      const base = cumulative[Math.min(periodIndex, freezeIndex)] ?? previous;
      if (base <= 0) continue;

      const pace = 1 + (blueprint.performance - 1) * (periodIndex / dataIndex);
      let actual = base * pace * factor;
      if (blueprint.status === "completed") {
        actual = periodIndex === dataIndex ? 100 : Math.min(actual, 100);
      }
      // Readings are cumulative: they cannot go backwards, whatever the shaping
      // above works out to.
      actual = clamp(Math.max(previous, actual), 0, 100);
      previous = actual;

      const lumpSum = row.progressMode === "by_percent";
      progress.push({
        id: uuidFrom(row.id!, "progress", periodIndex),
        projectId,
        periodId: periodIds[periodIndex - 1]!,
        boqItemId: row.id!,
        cumulativeQuantity: lumpSum ? null : dec((leafMeta[index]!.quantity * actual) / 100, 4),
        cumulativePercent: lumpSum ? dec(actual, 4) : null,
        pctComplete: dec(actual, 4),
        recordedById: ctx.actorId,
      });
    }
  }

  const dataDate = dataIndex > 0 ? generated[dataIndex - 1]!.endDate : null;

  // --- what the app will draw, computed here with the app's own functions so
  //     the dry run is a check rather than a second opinion.
  const itemLikes = [...sections, ...leafRows].map((row) => ({
    id: row.id!,
    parentId: row.parentId ?? null,
    code: row.code!,
    description: row.description!,
    weight: Number(row.weight),
    sortOrder: row.sortOrder!,
  }));
  const periodLikes = generated.map((period, position) => ({
    id: periodIds[position]!,
    periodIndex: period.periodIndex,
    startDate: period.startDate,
    endDate: period.endDate,
  }));
  const cellMap = distributionMap(
    distribution.map((cell) => ({
      boqItemId: cell.boqItemId,
      periodId: cell.periodId,
      plannedPct: Number(cell.plannedPct),
    })),
  );
  const entryLikes = progress.map((entry) => ({
    boqItemId: entry.boqItemId,
    periodId: entry.periodId,
    pctComplete: Number(entry.pctComplete),
    cumulativeQuantity:
      entry.cumulativeQuantity === null || entry.cumulativeQuantity === undefined
        ? null
        : Number(entry.cumulativeQuantity),
    cumulativePercent:
      entry.cumulativePercent === null || entry.cumulativePercent === undefined
        ? null
        : Number(entry.cumulativePercent),
  }));

  const matrixRows = scheduleRows(itemLikes);
  const planned = computePlannedCurve(matrixRows, periodLikes, cellMap);
  const actualCurve = computeActualCurve(matrixRows, periodLikes, entryLikes, dataDate);

  const plannedPct = dataIndex > 0 ? round(planned.cumulative[dataIndex - 1] ?? 0, 1) : null;
  const actualAt = dataIndex > 0 ? actualCurve.cumulative[dataIndex - 1] : null;
  const actualPct = actualAt === null || actualAt === undefined ? null : round(actualAt, 1);

  const contributors =
    dataIndex > 0 ? delayContributors(matrixRows, periodLikes, cellMap, entryLikes, dataDate) : [];
  const worst = contributors.find((row) => row.variance !== null && row.variance < 0);

  // --- the site progress fallback, for the projects with no baseline reading.
  const headlineProgress = actualPct === null ? 0 : clamp(Math.round(actualPct), 0, 100);

  // --- actions.
  const ticketCount = 3 + Math.floor(random() * 3);
  const tickets: (typeof ticket.$inferInsert)[] = [];
  const ticketIds: string[] = [];
  const statuses: TicketStatus[] = ["open", "in_progress", "resolved", "open", "closed"];

  for (let index = 0; index < ticketCount; index++) {
    const template = ACTION_POOL[(order * 3 + index) % ACTION_POOL.length]!;
    const ticketId = uuidFrom(projectId, "ticket", index);
    const status = blueprint.status === "completed" ? "closed" : statuses[index % statuses.length]!;
    const closed = status === "resolved" || status === "closed";
    const raised = shiftIso(dataDate ?? startDate, -7 * (index + 1));

    ticketIds.push(ticketId);
    tickets.push({
      id: ticketId,
      projectId,
      title: template.title,
      description: template.description,
      issuerId: ctx.actorId,
      issuerName: ctx.actorName,
      responsibleName: ["Budi Santoso", "Rina Wijaya", "Agus Prasetyo", "Sri Handayani"][index % 4]!,
      responsibleContactNumber: `+62 812 ${1000 + index * 7} ${2000 + order * 11}`,
      status,
      type: template.type,
      priority: template.priority,
      // An overdue open action is what puts a project on the attention list.
      dueDate: closed ? null : shiftIso(raised, index % 2 === 0 ? -3 : 21),
      assigneeId: ctx.actorId,
      closedAt: closed ? stamp(shiftIso(raised, 9), 11) : null,
      resolution: closed ? "Sudah ditindaklanjuti di lapangan dan diverifikasi pengawas." : null,
      boqItemId: leafRows[(index * 5) % leafRows.length]!.id!,
      periodId: dataIndex > 0 ? periodIds[dataIndex - 1]! : null,
      createdAt: stamp(raised, 9),
    });
  }

  // --- daily reports, for the projects that run them.
  const dailyReports: (typeof dailyReport.$inferInsert)[] = [];
  const manpower: (typeof dailyReportManpower.$inferInsert)[] = [];
  const equipment: (typeof dailyReportEquipment.$inferInsert)[] = [];
  const deliveries: (typeof dailyReportDelivery.$inferInsert)[] = [];

  if (blueprint.dailyReports && dataDate) {
    for (let back = 0; back < 8; back++) {
      const reportDate = shiftIso(dataDate, -back);
      if (reportDate < startDate) break;
      const reportId = uuidFrom(projectId, "daily", back);
      const owning = generated.find(
        (period) => period.startDate <= reportDate && reportDate <= period.endDate,
      );
      const weather = WEATHER[(order + back) % WEATHER.length]!;
      const wet = weather === "light_rain" || weather === "heavy_rain";

      dailyReports.push({
        id: reportId,
        projectId,
        reportDate,
        periodId: owning ? periodIds[owning.periodIndex - 1]! : null,
        weather,
        weatherNote: wet ? "Hujan turun sejak siang, pekerjaan luar dihentikan sementara." : null,
        rainfallHours: wet ? dec(1.5 + back * 0.25, 2) : null,
        workPerformed:
          "Pengecoran struktur zona 2, pemasangan bekisting zona 3, dan pekerjaan pasangan dinding lantai bawah.",
        delays: wet ? "Kehilangan 2 jam kerja akibat hujan pada pekerjaan luar." : null,
        safetyObservations: "Toolbox meeting pagi diikuti seluruh pekerja. Tidak ada insiden.",
        qualityObservations: "Slump test beton sesuai spesifikasi. Sampel kubus diambil 3 buah.",
        visitors: back % 3 === 0 ? "Konsultan pengawas dan perwakilan pemilik proyek." : null,
        status: back === 0 ? "submitted" : "approved",
        preparedById: ctx.actorId,
        preparedByName: ctx.actorName,
        submittedAt: stamp(reportDate, 18),
        ...(back === 0
          ? {}
          : {
              reviewedById: ctx.reviewerId,
              reviewedAt: stamp(shiftIso(reportDate, 1), 9),
              approvedById: ctx.reviewerId,
              approvedAt: stamp(shiftIso(reportDate, 1), 14),
            }),
        createdAt: stamp(reportDate, 18),
      });

      for (const [index, trade] of TRADES.entries()) {
        const headcount = 6 + Math.floor(random() * 26);
        manpower.push({
          id: uuidFrom(reportId, "manpower", index),
          reportId,
          trade,
          headcount,
          hours: dec(headcount * (wet ? 6 : 8), 2),
          sortOrder: index,
        });
      }

      for (let index = 0; index < 3; index++) {
        const name = EQUIPMENT[(back + index) % EQUIPMENT.length]!;
        const idle = wet && index === 2;
        equipment.push({
          id: uuidFrom(reportId, "equipment", index),
          reportId,
          name,
          quantity: 1 + (index % 2),
          hoursUsed: dec(idle ? 0 : 6 + index, 2),
          idle,
          note: idle ? "Standby karena hujan." : null,
          sortOrder: index,
        });
      }

      for (let index = 0; index < 2; index++) {
        const material = MATERIALS[(back * 2 + index) % MATERIALS.length]!;
        deliveries.push({
          id: uuidFrom(reportId, "delivery", index),
          reportId,
          material: material.material,
          quantity: dec(40 + Math.floor(random() * 160), 4),
          unit: material.unit,
          supplier: material.supplier,
          reference: `DO-${blueprint.code}-${String(back * 2 + index + 1).padStart(4, "0")}`,
          boqItemId: leafRows[(back + index) % leafRows.length]!.id!,
          sortOrder: index,
        });
      }
    }
  }

  // --- the audit feed. Only ids this script can regenerate are used, because
  //     activityLog has no foreign key and so never cascades on delete.
  const activity: (typeof activityLog.$inferInsert)[] = [
    {
      id: uuidFrom(projectId, "activity", "created"),
      companyId: ctx.companyId,
      actorId: ctx.actorId,
      actorName: ctx.actorName,
      action: "created",
      entityType: "project",
      entityId: projectId,
      entityLabel: `${blueprint.code} ${blueprint.name}`,
      createdAt: stamp(openedDate, 8),
    },
    {
      id: uuidFrom(projectId, "activity", "generated"),
      companyId: ctx.companyId,
      actorId: ctx.actorId,
      actorName: ctx.actorName,
      action: "generated",
      entityType: "period",
      entityId: projectId,
      entityLabel: `${blueprint.code} ${blueprint.name}`,
      detail: `${periodCount} periode`,
      createdAt: stamp(openedDate, 9),
    },
    {
      id: uuidFrom(projectId, "activity", "baselined"),
      companyId: ctx.companyId,
      actorId: ctx.actorId,
      actorName: ctx.actorName,
      action: "baselined",
      entityType: "boq",
      entityId: versionId,
      entityLabel: `${blueprint.code} baseline v1`,
      detail: `${leafRows.length} item`,
      createdAt: stamp(openedDate, 10),
    },
  ];

  if (dataDate) {
    activity.push({
      id: uuidFrom(projectId, "activity", "progress"),
      companyId: ctx.companyId,
      actorId: ctx.actorId,
      actorName: ctx.actorName,
      action: "progress_recorded",
      entityType: "progress",
      entityId: projectId,
      entityLabel: `${blueprint.code} ${blueprint.name}`,
      detail: `${generated[dataIndex - 1]!.label} - ${actualPct ?? 0}%`,
      createdAt: stamp(dataDate, 17),
    });
  }

  for (const [index, ticketId] of ticketIds.entries()) {
    activity.push({
      id: uuidFrom(ticketId, "activity"),
      companyId: ctx.companyId,
      actorId: ctx.actorId,
      actorName: ctx.actorName,
      action: "created",
      entityType: "ticket",
      entityId: ticketId,
      entityLabel: tickets[index]!.title,
      createdAt: tickets[index]!.createdAt as Date,
    });
  }

  return {
    blueprint,
    projectId,
    versionId,
    ticketIds,
    rows: {
      projects: [
        {
          id: projectId,
          companyId: ctx.companyId,
          code: blueprint.code,
          name: blueprint.name,
          client: blueprint.client,
          location: blueprint.location,
          status: blueprint.status,
          startDate,
          endDate,
          progress: headlineProgress,
          periodType: blueprint.periodType,
          scheduleStart: startDate,
          dataDate,
          managerId: ctx.actorId,
          notes: null,
          createdAt: stamp(openedDate, 8),
        },
      ],
      members: [{ projectId, userId: ctx.actorId, createdAt: stamp(openedDate, 8) }],
      periods,
      periodEvents,
      versions: [
        {
          id: versionId,
          projectId,
          versionNo: 1,
          title: "Baseline kontrak",
          status: "active",
          scheduleStatus: "active",
          totalValue: dec(contractValue, 2),
          baselinedAt: stamp(openedDate, 10),
          baselinedById: ctx.actorId,
          scheduleBaselinedAt: stamp(openedDate, 10),
          scheduleBaselinedById: ctx.actorId,
          createdAt: stamp(openedDate, 9),
        },
      ],
      sections,
      leaves: leafRows,
      distribution,
      progress,
      tickets,
      dailyReports,
      manpower,
      equipment,
      deliveries,
      activity,
    },
    summary: {
      periods: periodCount,
      sections: sections.length,
      leaves: leafRows.length,
      contractValue,
      plannedPct,
      actualPct,
      dataDate,
      worstLine: worst ? worst.leaf.description : null,
      worstSlip: worst?.variance != null ? round(worst.variance, 1) : null,
    },
  };
}

// ------------------------------------------------------------- executing --

const rupiah = (value: number) =>
  value >= 1_000_000_000_000
    ? `Rp ${(value / 1_000_000_000_000).toFixed(2)} T`
    : `Rp ${(value / 1_000_000_000).toFixed(1)} M`;

/**
 * Which tenant the projects belong in.
 *
 * Not hardcoded, because the point of this data is to be visible to the account
 * the marketing screenshots are taken as. `--company` wins if given; otherwise
 * the capture account's own company; otherwise the oldest one, which is what
 * resolveCompanyIdForSession falls back to for a super admin with no company
 * cookie set.
 */
async function resolveTarget(email: string) {
  const [account] = await db
    .select({
      id: user.id,
      name: user.name,
      role: user.role,
      companyId: user.companyId,
      mustChangePassword: user.mustChangePassword,
    })
    .from(user)
    .where(eq(user.email, email));

  if (!account) {
    throw new Error(
      `No account ${email}. That is the address the screenshot capture signs in as (CAPTURE_EMAIL in apps/marketing/.env.local) — create it first, or pass --user=<email>.`,
    );
  }

  const requested = flag("company")?.toUpperCase();
  const companies = await db
    .select({ id: company.id, name: company.name, code: company.code })
    .from(company)
    .orderBy(asc(company.createdAt));

  const target = requested
    ? companies.find((row) => row.code === requested)
    : (companies.find((row) => row.id === account.companyId) ?? companies[0]);

  if (!target) {
    throw new Error(
      requested
        ? `No company with code ${requested}. Known codes: ${companies.map((row) => row.code).join(", ") || "none"}.`
        : "No companies exist yet. Create one under Admin, Companies first.",
    );
  }

  /*
   * Someone who may actually sign a period off: a super admin first (they act
   * across companies), then an admin inside this company. Falling back to the
   * capture account is honest but produces a history the workflow would not
   * have allowed, so it says so.
   */
  const supervisors = await db
    .select({ id: user.id, name: user.name, role: user.role, companyId: user.companyId })
    .from(user)
    .where(inArray(user.role, ["super_admin", "admin"]));
  const reviewer =
    supervisors.find((row) => row.role === "super_admin") ??
    supervisors.find((row) => row.companyId === target.id) ??
    null;

  return { account, target, companies, reviewer };
}

async function main() {
  const email = flag("user") ?? DEFAULT_CAPTURE_EMAIL;
  const { account, target, reviewer } = await resolveTarget(email);

  console.log(`Capture account   ${email}`);
  console.log(`  role            ${account.role ?? "user"}`);
  console.log(`  companyId       ${account.companyId ?? "(none, resolves by cookie or oldest)"}`);
  console.log(`  must change pw  ${account.mustChangePassword}`);
  console.log(`Target company    ${target.name} (${target.code})`);
  console.log(
    `Signs off periods ${reviewer ? `${reviewer.name} (${reviewer.role})` : `${account.name} - no supervisor account exists`}`,
  );

  if (account.mustChangePassword) {
    console.warn(
      "\nWarning: this account still has to change its password on next sign-in, so `bun run shots` will fail on it. Sign in once and set a permanent password.",
    );
  }

  const ctx: Ctx = {
    companyId: target.id,
    actorId: account.id,
    actorName: account.name || "Administrator",
    reviewerId: reviewer?.id ?? account.id,
    reviewerName: reviewer?.name || account.name || "Administrator",
  };

  const built = BLUEPRINTS.map((blueprint, order) => buildProject(blueprint, ctx, order));

  // --- what it comes to.
  const totals = built.reduce(
    (sum, item) => ({
      periods: sum.periods + item.rows.periods.length,
      leaves: sum.leaves + item.rows.leaves.length,
      cells: sum.cells + item.rows.distribution.length,
      readings: sum.readings + item.rows.progress.length,
      actions: sum.actions + item.rows.tickets.length,
      reports: sum.reports + item.rows.dailyReports.length,
      value: sum.value + item.summary.contractValue,
    }),
    { periods: 0, leaves: 0, cells: 0, readings: 0, actions: 0, reports: 0, value: 0 },
  );

  console.log("\nCode     Status     Periods  Lines  Contract      Planned  Actual   Deviation");
  for (const item of built) {
    const { summary, blueprint } = item;
    const deviation =
      summary.plannedPct === null || summary.actualPct === null
        ? "        -"
        : `${(summary.actualPct - summary.plannedPct >= 0 ? "+" : "") + round(summary.actualPct - summary.plannedPct, 1).toFixed(1)}%`.padStart(
            9,
          );
    console.log(
      [
        blueprint.code.padEnd(8),
        blueprint.status.padEnd(10),
        String(summary.periods).padStart(7),
        String(summary.leaves).padStart(7),
        rupiah(summary.contractValue).padStart(13),
        (summary.plannedPct === null ? "-" : `${summary.plannedPct.toFixed(1)}%`).padStart(9),
        (summary.actualPct === null ? "-" : `${summary.actualPct.toFixed(1)}%`).padStart(8),
        deviation,
      ].join(" "),
    );
    if (summary.worstLine) {
      console.log(`         worst line: ${summary.worstLine} (${summary.worstSlip} poin)`);
    }
  }

  console.log(
    `\nTotals: ${built.length} projects, ${totals.periods} periods, ${totals.leaves} lines, ${totals.cells} planned cells, ${totals.readings} readings, ${totals.actions} actions, ${totals.reports} daily reports, ${rupiah(totals.value)} contract value.`,
  );

  if (isDryRun) {
    console.log("\nDry run: nothing was written.");
    return;
  }

  // --- clear, then write. Exactly these codes, in this company only.
  const owned = and(eq(project.companyId, ctx.companyId), inArray(project.code, CODES));
  const existing = await db.select({ id: project.id }).from(project).where(owned);
  if (existing.length > 0) await db.delete(project).where(owned);

  /*
   * activityLog holds no foreign key to what it describes (deliberately, see
   * its schema comment), so nothing above cascades into it. Every id this
   * script writes is a hash of its inputs, which is what makes cleaning it up
   * by id possible rather than guessing at a prefix.
   */
  const activityIds = built.flatMap((item) => [item.projectId, item.versionId, ...item.ticketIds]);
  await db
    .delete(activityLog)
    .where(and(eq(activityLog.companyId, ctx.companyId), inArray(activityLog.entityId, activityIds)));

  console.log(`\nCleared ${existing.length} previously seeded project(s)`);

  for (const item of built) {
    const { rows } = item;
    const statements = [
      db.insert(project).values(rows.projects),
      db.insert(projectMember).values(rows.members),
      ...chunk(rows.periods, CHUNK).map((batch) => db.insert(reportingPeriod).values(batch)),
      ...chunk(rows.periodEvents, CHUNK).map((batch) =>
        db.insert(reportingPeriodEvent).values(batch),
      ),
      db.insert(boqVersion).values(rows.versions),
      // Sections before leaves: parentId is a foreign key into the same table.
      db.insert(boqItem).values(rows.sections),
      ...chunk(rows.leaves, CHUNK).map((batch) => db.insert(boqItem).values(batch)),
      ...chunk(rows.distribution, CHUNK).map((batch) =>
        db.insert(boqItemDistribution).values(batch),
      ),
      ...chunk(rows.progress, CHUNK).map((batch) => db.insert(progressEntry).values(batch)),
      ...chunk(rows.tickets, CHUNK).map((batch) => db.insert(ticket).values(batch)),
      ...chunk(rows.dailyReports, CHUNK).map((batch) => db.insert(dailyReport).values(batch)),
      ...chunk(rows.manpower, CHUNK).map((batch) => db.insert(dailyReportManpower).values(batch)),
      ...chunk(rows.equipment, CHUNK).map((batch) => db.insert(dailyReportEquipment).values(batch)),
      ...chunk(rows.deliveries, CHUNK).map((batch) => db.insert(dailyReportDelivery).values(batch)),
      ...chunk(rows.activity, CHUNK).map((batch) => db.insert(activityLog).values(batch)),
    ];

    await runBatch(statements);
    console.log(
      `  ${item.blueprint.code}  ${String(rows.leaves.length).padStart(2)} lines  ${String(rows.periods.length).padStart(2)} periods  ${String(rows.distribution.length).padStart(4)} cells  ${String(rows.progress.length).padStart(4)} readings`,
    );
  }

  console.log(`\nWrote ${built.length} projects into ${target.name} (${target.code}).`);
  console.log("Next: bun run dev:server + bun run dev:web, then bun run shots.");
}

main().catch((error) => {
  console.error("Failed to seed the portfolio:", error instanceof Error ? error.message : error);
  process.exit(1);
});
