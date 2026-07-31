/**
 * The BoQ progress maths now lives in packages/api/src/lib/curves.ts.
 *
 * It moved there when the per-project spreadsheet export arrived: the export is
 * built in apps/server, which cannot import from apps/web, and the S-curve sheet
 * needs the same planned/actual curves this app draws. Re-implementing
 * computeActualCurve on the server would have meant a second copy of three
 * carry-forward rules whose test file is explicitly the specification — exactly
 * the kind of duplication that drifts silently and makes a spreadsheet disagree
 * with the chart it was exported from.
 *
 * Re-exported from here rather than repointing the four call sites so that
 * `@/lib/boq/curves` stays the name this app knows it by.
 */
export * from "@DashboardV2/api/lib/curves";
