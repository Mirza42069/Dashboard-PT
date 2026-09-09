/**
 * Read-only authenticated benchmark against existing listeners.
 * Run: bun scripts/benchmark-dashboard.ts
 * Required execution env: BENCHMARK_EMAIL, BENCHMARK_PASSWORD.
 * Optional: BASE_URL, API_URL, BENCHMARK_MODE (observed listener mode).
 * Outputs sanitized JSON only. No traces, screenshots, or persisted auth state.
 */
import { chromium, type BrowserContext, type Page } from "playwright";

const email = process.env.BENCHMARK_EMAIL;
const password = process.env.BENCHMARK_PASSWORD;
// Do not pass credentials or Playwright debug logging to browser subprocesses.
delete process.env.BENCHMARK_EMAIL;
delete process.env.BENCHMARK_PASSWORD;
delete process.env.DEBUG;
delete process.env.PWDEBUG;
const base = new URL(process.env.BASE_URL ?? "http://localhost:3001");
const api = new URL(process.env.API_URL ?? (base.hostname === "localhost"
  ? "http://localhost:3000" : `${base.origin}/api`));
const samples = 5;
const timeout = 90_000;
type Sample = { readyMs: number; ttfbMs?: number; dclMs?: number };
const results: Record<string, Sample[]> = { freshContext: [], repeatDocument: [], clientReturn: [] };
const failures: { group: string; sample: number; phase: string }[] = [];
const apiResults: Record<string, number[]> = { summary: [], exceptions: [] };
const counts: Record<string, number> = {};
const loginDiagnostic = { requestSent: false, requestFailed: false, pageErrors: 0,
  httpStatus: null as number | null, destination: "unknown" };
let phase = "configuration";
let browserVersion = "unknown";
const round = (n: number) => Math.round(n * 10) / 10;
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  return { n, median: round((sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2),
    min: round(sorted[0]!), max: round(sorted[n - 1]!),
    ...(n >= 20 ? { p95: round(sorted[Math.ceil(n * 0.95) - 1]!) } : {}) };
}

async function guard(context: BrowserContext) {
  context.setDefaultTimeout(timeout);
  context.setDefaultNavigationTimeout(timeout);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const credentialInUrl = [...url.searchParams.keys()].some((key) => /password|identifier|email/i.test(key));
    const login = request.method() === "POST" && url.origin === api.origin
      && /\/auth\/sign-in\/email$/.test(url.pathname);
    if (credentialInUrl || (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !login)) {
      await route.abort();
      return;
    }
    await route.continue();
  });
  await context.addInitScript(() => {
    // React must cancel submit. Prevent any native fallback before it can leak fields.
    window.addEventListener("submit", (event) => {
      if (!event.defaultPrevented) event.preventDefault();
    });
  });
}

async function ready(page: Page) {
  const state = await page.waitForFunction(() => {
    const statuses = [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent?.trim());
    if (statuses.some((text) => text === "Could not load this" || text === "Tidak dapat memuat data ini")) return "error";
    if (statuses.some((text) => text === "Overview data loaded" || text === "Data ringkasan telah dimuat")) return "ready";
    return false;
  });
  if (await state.jsonValue() !== "ready" || new URL(page.url()).pathname !== "/dashboard") {
    throw new Error("Dashboard readiness failed");
  }
}

async function documentSample(page: Page): Promise<Sample> {
  const start = performance.now();
  phase = "document-navigation";
  const response = await page.goto(`${base.origin}/dashboard`, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error("Document response failed");
  phase = "dashboard-ready";
  await ready(page);
  const readyMs = performance.now() - start;
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return { ttfbMs: nav.responseStart - nav.startTime, dclMs: nav.domContentLoadedEventEnd - nav.startTime };
  });
  return { readyMs, ...timing };
}

async function main() {
  if (!email || !password || base.username || base.password || api.username || api.password) {
    throw new Error("Invalid configuration");
  }
  phase = "browser-launch";
  const browser = await chromium.launch({ headless: true });
  browserVersion = browser.version();
  try {
    const loginContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await guard(loginContext);
    const loginPage = await loginContext.newPage();
    loginPage.on("pageerror", () => { loginDiagnostic.pageErrors++; });
    loginPage.on("request", (request) => {
      if (request.method() === "POST" && /\/auth\/sign-in\/email$/.test(new URL(request.url()).pathname)) loginDiagnostic.requestSent = true;
    });
    loginPage.on("requestfailed", (request) => {
      if (request.method() === "POST" && /\/auth\/sign-in\/email$/.test(new URL(request.url()).pathname)) loginDiagnostic.requestFailed = true;
    });
    phase = "login-hydration";
    await loginPage.goto(`${base.origin}/login`, { waitUntil: "domcontentloaded" });
    await loginPage.waitForFunction(() => document.activeElement?.getAttribute("name") === "identifier");
    // Autofocus can precede completion of React hydration in development.
    await loginPage.waitForFunction(() => {
      const input = document.querySelector('input[name="identifier"]');
      const form = input?.closest("form");
      if (!input || !form) return false;
      const formProps = Object.entries(form).find(([key]) => key.startsWith("__reactProps$"))?.[1];
      const inputProps = Object.entries(input).find(([key]) => key.startsWith("__reactProps$"))?.[1];
      return typeof formProps?.onSubmit === "function" && typeof inputProps?.onChange === "function";
    });
    await loginPage.locator('input[name="identifier"]').fill(email);
    await loginPage.locator('input[name="password"]').fill(password);
    phase = "login-submit";
    try {
      const [response] = await Promise.all([
        loginPage.waitForResponse((response) => response.request().method() === "POST"
          && /\/auth\/sign-in\/email$/.test(new URL(response.url()).pathname)),
        loginPage.locator('button[type="submit"]').click(),
      ]);
      loginDiagnostic.httpStatus = response.status();
      if (loginDiagnostic.httpStatus >= 400) throw new Error("Login rejected");
      phase = "login-redirect";
      await loginPage.waitForURL(`${base.origin}/dashboard`);
    } finally {
      const path = new URL(loginPage.url()).pathname;
      loginDiagnostic.destination = ["/login", "/dashboard", "/change-password", "/set-password"].includes(path) ? path : "other";
    }
    phase = "login-dashboard-warmup";
    await ready(loginPage);
    const storageState = await loginContext.storageState();
    await loginContext.close();

    for (let i = 1; i <= samples; i++) {
      const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
      try {
        await guard(context);
        results.freshContext!.push(await documentSample(await context.newPage()));
      } catch { failures.push({ group: "freshContext", sample: i, phase }); }
      finally { await context.close(); }
    }

    const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    try {
      await guard(context);
      const page = await context.newPage();
      await documentSample(page); // Unmeasured warmup for reused context.
      for (let i = 1; i <= samples; i++) {
        try { results.repeatDocument!.push(await documentSample(page)); }
        catch { failures.push({ group: "repeatDocument", sample: i, phase }); }
      }
      for (let i = 1; i <= samples; i++) {
        try {
          phase = "projects-link";
          const origin = await page.evaluate(() => performance.timeOrigin);
          await page.locator('a[href="/projects"]:visible').first().click();
          await page.waitForURL(`${base.origin}/projects`);
          await page.getByRole("status").filter({ hasText: /^(Overview data loaded|Data ringkasan telah dimuat)$/ }).waitFor({ state: "detached" });
          phase = "dashboard-link";
          const link = page.locator('a[href="/dashboard"]:visible').first();
          await link.waitFor({ state: "visible" });
          const start = performance.now();
          await link.click();
          await page.waitForURL(`${base.origin}/dashboard`);
          phase = "client-dashboard-ready";
          await ready(page);
          const readyMs = performance.now() - start;
          if (await page.evaluate(() => performance.timeOrigin) !== origin) throw new Error("Not client navigation");
          results.clientReturn!.push({ readyMs });
        } catch {
          failures.push({ group: "clientReturn", sample: i, phase });
          await documentSample(page);
        }
      }

      for (const procedure of ["summary", "exceptions"] as const) {
        for (let i = 1; i <= samples; i++) {
          phase = `api-${procedure}`;
          try {
            const url = new URL(`${api.href.replace(/\/$/, "")}/trpc/project.${procedure}`);
            if (procedure === "exceptions") url.searchParams.set("input", JSON.stringify({ filter: "all", limit: 25, offset: 0 }));
            const start = performance.now();
            const response = await context.request.get(url.href, { timeout });
            const body = await response.json();
            const elapsed = performance.now() - start;
            const data = body?.result?.data;
            if (!response.ok() || body?.error || !data) throw new Error("Invalid tRPC response");
            if (procedure === "summary") {
              if (!Number.isInteger(data.projects?.total)) throw new Error("Invalid summary");
              counts.portfolioProjects = data.projects.total;
            } else {
              if (!Array.isArray(data.projects) || !Number.isInteger(data.total) || !Number.isInteger(data.counts?.live)) throw new Error("Invalid exceptions");
              counts.liveProjects = data.counts.live;
              counts.exceptionProjects = data.total;
              counts.exceptionPageRows = data.projects.length;
            }
            apiResults[procedure]!.push(elapsed);
            await response.dispose();
          } catch { failures.push({ group: `api-${procedure}`, sample: i, phase }); }
        }
      }
    } finally { await context.close(); }
  } finally { await browser.close(); }
}

try { await main(); }
catch { failures.push({ group: "setup-or-recovery", sample: 0, phase }); }
console.log(JSON.stringify({
  timestamp: new Date().toISOString(), mode: process.env.BENCHMARK_MODE ?? "unknown (inspect listener commands)",
  browser: `Chromium ${browserVersion}`, base: base.origin, api: api.origin, samplesRequested: samples,
  units: "ms", counts,
  navigation: Object.fromEntries(Object.entries(results).map(([group, rows]) => [group, {
    ready: stats(rows.map((row) => row.readyMs)),
    ttfb: stats(rows.flatMap((row) => row.ttfbMs === undefined ? [] : [row.ttfbMs])),
    dcl: stats(rows.flatMap((row) => row.dclMs === undefined ? [] : [row.dclMs])),
    samples: rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, round(value)]))),
  }])),
  apiTimings: Object.fromEntries(Object.entries(apiResults).map(([key, values]) => [key, { ...stats(values), samples: values.map(round) }])),
  failures, loginDiagnostic,
  limitations: [
    "Five sequential samples per group; no p95 below 20 samples.",
    "Login and explicit dashboard warmups excluded; server and OS caches remain warm.",
    "Fresh contexts are cold browser state, not fresh browser processes.",
    "Request routing disables HTTP cache in all contexts; repeat documents reuse connections, not HTTP cache.",
    "Client returns retain Next router/query caches and normal link prefetch; projects leg excluded.",
    "Ready is automation wall time to localized success status; TTFB/DCL are Navigation Timing since startTime.",
    "API timings include response transfer and JSON parsing; payloads and auth state never output.",
    "No CPU/network throttling; dev compilation and concurrent activity may affect results.",
  ],
}, null, 2));
if (failures.length) process.exitCode = 1;
