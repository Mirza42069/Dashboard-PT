/**
 * Captures the product screenshots used by the marketing landing page.
 *
 * The landing page shows the real dashboard rather than drawn mockups, so
 * these images have to be regenerated whenever the UI moves. They are written
 * to apps/marketing/public/product/ and read back by apps/marketing/src/lib/shots.ts,
 * which resolves each one at request time — a missing file renders a
 * placeholder frame instead of breaking the page.
 *
 *   bun run dev:server     # port 3000
 *   bun run dev:web        # port 3001
 *   bun run shots
 *
 * Credentials come from apps/marketing/.env.local and are never defaulted or
 * committed. The script fails loudly rather than guessing.
 *
 * NOTE: whatever is in the account at capture time ends up on a public,
 * indexable marketing site. Review every PNG before shipping it.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { chromium, type Page } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "apps", "marketing", "public", "product");

dotenv.config({ path: join(ROOT, "apps", "marketing", ".env.local"), quiet: true });

const EMAIL = process.env.CAPTURE_EMAIL;
const PASSWORD = process.env.CAPTURE_PASSWORD;
const BASE_URL = process.env.CAPTURE_BASE_URL ?? "http://localhost:3001";
/**
 * Which project the progress and BoQ shots come from, by code.
 *
 * Without it the shots come from whichever row the list happens to put first,
 * which is the most recently created project — often the one with the least in
 * it. The two shots are of a populated schedule and a populated BoQ, so which
 * project they come from is a decision, not an accident.
 *
 * Pick one whose current period has already been submitted. The progress tab
 * puts the entry matrix above the S-curve while the period is still editable
 * (progress-tab.tsx, `entryFirst`), which pushes the chart — the actual subject
 * of the shot — out of the first viewport.
 */
const PROJECT_CODE = process.env.CAPTURE_PROJECT_CODE?.trim();

if (!EMAIL || !PASSWORD) {
  console.error(
    [
      "Missing capture credentials.",
      "",
      "Add these to apps/marketing/.env.local (gitignored):",
      "  CAPTURE_EMAIL=you@example.com",
      "  CAPTURE_PASSWORD=…",
      "  CAPTURE_BASE_URL=http://localhost:3001",
      "  CAPTURE_PROJECT_CODE=PRJ-109   # optional, picks the project to shoot",
    ].join("\n"),
  );
  process.exit(1);
}

/** Wide enough that the dashboard renders its desktop layout, not a tablet one. */
const VIEWPORT = { width: 1600, height: 1000 };

type Shot = {
  name: string;
  /** Path relative to BASE_URL. */
  path: string;
  /** Something that must be on screen before the shutter fires. */
  settle: (page: Page) => Promise<void>;
  /** Optional interaction to run after navigation, e.g. opening a dialog. */
  prepare?: (page: Page) => Promise<void>;
};

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  const captured: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  try {
    await signIn(page);

    const target = await projectHref(page);
    if (!target) {
      skipped.push({ name: "progress", reason: "no project found in /projects" });
      skipped.push({ name: "boq", reason: "no project found in /projects" });
    }

    const shots: Shot[] = [
      {
        name: "dashboard",
        path: "/dashboard",
        settle: async (p) => {
          await p.getByRole("main").waitFor({ state: "visible", timeout: 30_000 });
          await p.waitForLoadState("networkidle");
        },
      },
      ...(target
        ? ([
            {
              name: "progress",
              path: `${target}${target.includes("?") ? "&" : "?"}tab=progress`,
              settle: async (p) => {
                // The selected tab exists before its content does — waiting on
                // it photographs the loading skeleton. Wait for the card that is
                // the subject of the shot.
                const chart = p.getByText(/rencana vs realisasi|planned vs actual/i).first();
                await chart.waitFor({ state: "visible", timeout: 30_000 });
                await p.waitForLoadState("networkidle");
                // The S-curve is a client chart; give it a frame to draw.
                await p.waitForTimeout(1200);
                /*
                 * The progress tab puts the entry grid above the figures while
                 * any period is still open (progress-tab.tsx, `entryFirst`),
                 * which is every live project — so the chart is usually below
                 * the fold. Bring it into frame rather than photographing a
                 * grid of input boxes.
                 */
                await chart.scrollIntoViewIfNeeded();
                await p.waitForTimeout(500);
              },
            },
            {
              name: "boq",
              path: `${target}${target.includes("?") ? "&" : "?"}tab=baseline`,
              settle: async (p) => {
                // Same reasoning: the priced lines, not the skeleton that
                // precedes them. The weight column header is on every BoQ.
                await p
                  .getByText(/^(bobot|weight)$/i)
                  .first()
                  .waitFor({ state: "visible", timeout: 30_000 });
                await p.waitForLoadState("networkidle");
                await p.waitForTimeout(800);
              },
            },
          ] satisfies Shot[])
        : []),
      {
        name: "import",
        path: "/projects",
        prepare: openImportDialog,
        settle: async (p) => {
          await p.getByRole("dialog").waitFor({ state: "visible", timeout: 15_000 });
          await p.waitForTimeout(600);
        },
      },
    ];

    for (const shot of shots) {
      try {
        await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await shot.prepare?.(page);
        await shot.settle(page);
        await hideDevOverlays(page);
        const file = join(OUT_DIR, `${shot.name}.png`);
        await page.screenshot({ path: file });
        captured.push(shot.name);
        console.log(`captured  ${shot.name}.png`);
      } catch (error) {
        const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
        skipped.push({ name: shot.name, reason });
        console.warn(`skipped   ${shot.name} — ${reason}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${captured.length} captured → apps/marketing/public/product/`);
  if (skipped.length) {
    console.log(`${skipped.length} skipped:`);
    for (const item of skipped) console.log(`  ${item.name}: ${item.reason}`);
    console.log("\nSkipped shots render as placeholder frames on the page, not as fake screenshots.");
  }
  console.log("\nReview every PNG before shipping — these go on a public site.");
}

/**
 * Two dev-only widgets float over the app corners and would otherwise land in
 * every screenshot: Next's dev indicator (`nextjs-portal`) and the TanStack
 * Query devtools launcher (`.tsqd-parent-container`).
 *
 * Injected per navigation rather than via addInitScript — both mount after
 * hydration, and a stylesheet added before they exist gets discarded when the
 * React tree takes over the document.
 */
async function hideDevOverlays(page: Page) {
  await page.addStyleTag({
    content:
      "nextjs-portal,[data-nextjs-dev-tools-button],#__next-build-watcher,.tsqd-parent-container{display:none!important}",
  });
  // The style lands synchronously, but give layout one frame to settle.
  await page.waitForTimeout(150);
}

async function signIn(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // The sign-in fields are React-controlled and the submit handler lives in JS.
  // Filling or clicking before hydration silently degrades to a native GET,
  // which puts the password in the query string and never authenticates.
  // The email input carries autoFocus, so it receiving focus is an exact
  // hydration signal — wait for that rather than a fixed sleep.
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(
    () => document.activeElement instanceof HTMLInputElement && document.activeElement.name === "email",
    undefined,
    { timeout: 30_000 },
  );

  await page.locator('input[name="email"]').fill(EMAIL!);
  await page.locator('input[name="password"]').fill(PASSWORD!);
  await page.getByRole("button", { name: /sign in|masuk/i }).click();

  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 45_000 });

  if (page.url().includes("/change-password")) {
    throw new Error(
      "This account must change its password before it can be used. Sign in manually once, set a permanent password, then re-run.",
    );
  }
}

/**
 * The href of the project to screenshot: the one named by CAPTURE_PROJECT_CODE
 * if it is set and present, otherwise the first row. Returns null on an empty
 * list, which downgrades those shots to placeholders rather than failing.
 */
async function projectHref(page: Page): Promise<string | null> {
  try {
    await page.goto(`${BASE_URL}/projects`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle");

    const links = page.locator('a[href^="/projects/"]');
    await links.first().waitFor({ state: "attached", timeout: 20_000 });

    if (PROJECT_CODE) {
      // The link text is the project name; the code sits in a sibling element,
      // so the match has to be made against the whole row.
      const row = page.getByRole("row").filter({ hasText: PROJECT_CODE }).first();
      const link = row.locator('a[href^="/projects/"]').first();
      if ((await link.count()) > 0) return await link.getAttribute("href");
      console.warn(`CAPTURE_PROJECT_CODE=${PROJECT_CODE} matched no row; using the first one.`);
    }

    return await links.first().getAttribute("href");
  } catch {
    return null;
  }
}

/**
 * Opens the workbook import dialog from the projects page. The exact control
 * has moved before, so this tries the labelled routes and gives up cleanly
 * rather than screenshotting whatever happens to be on screen.
 */
async function openImportDialog(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /new project|proyek baru|add project|tambah/i }).first().click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 15_000 });
  await page
    .getByRole("button", { name: /excel|workbook|import|impor/i })
    .first()
    .click();
}

await main();
