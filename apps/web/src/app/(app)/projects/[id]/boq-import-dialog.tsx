"use client";

import { Alert, AlertDescription, AlertTitle } from "@DashboardV2/ui/components/alert";
import { Button } from "@DashboardV2/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@DashboardV2/ui/components/dialog";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { env } from "@DashboardV2/env/web";
import { CheckCircle2, Download, Loader2, TriangleAlert } from "@DashboardV2/ui/components/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { interpolate } from "@/i18n";
import { QueryError } from "@/components/query-error";
import { useT } from "@/i18n/provider";
import { downloadFromServer } from "@/lib/download-file";
import { getServerUrl } from "@/lib/server-url";
import { toast } from "@/lib/toast";
import { trpc } from "@/utils/trpc";

/**
 * Building a BoQ from a spreadsheet, in three steps: choose the file, match the
 * columns, read what happened.
 *
 * The workbook is uploaded twice — once to preview it and once to import it —
 * because the server keeps nothing between the two requests. That is a real
 * constraint of running on serverless functions, not an oversight: a parsed
 * workbook cannot outlive the invocation that parsed it, and inventing a
 * staging store to avoid one repeated upload of a ≤4 MB file would be the more
 * expensive mistake.
 *
 * Nothing here can activate a baseline. The import produces a *draft* revision
 * and the dialog says so; activation stays where it already is, behind the
 * review step and its confirmation.
 */

const FIELDS = [
  "code",
  "description",
  "parent",
  "unit",
  "quantity",
  "unitRate",
  "weight",
  "start",
  "finish",
] as const;
type Field = (typeof FIELDS)[number];

const NONE = "__none__";

type SheetPreview = {
  name: string;
  rowCount: number;
  headerRow: number;
  columns: { index: number; letter: string; header: string; samples: string[] }[];
};

type ImportError = { row: number; column: string | null; message: string };

type Outcome =
  | { status: "succeeded"; importId: string; versionNo: number; rowsImported: number; sectionCount: number; lineCount: number; scheduledCount: number }
  | { status: "failed"; importId: string; errors: ImportError[]; rowsTotal: number };

export default function BoqImportDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetPreview[] | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<Partial<Record<Field, number>>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldLabels: Record<Field, string> = {
    code: t.boqImport.fieldCode,
    description: t.boqImport.fieldDescription,
    parent: t.boqImport.fieldParent,
    unit: t.boqImport.fieldUnit,
    quantity: t.boqImport.fieldQuantity,
    unitRate: t.boqImport.fieldUnitRate,
    weight: t.boqImport.fieldWeight,
    start: t.boqImport.fieldStart,
    finish: t.boqImport.fieldFinish,
  };

  const sheet = sheets?.find((candidate) => candidate.name === sheetName) ?? null;
  const canImport = mapping.description !== undefined && file !== null && sheet !== null;

  function reset() {
    setFile(null);
    setSheets(null);
    setSheetName("");
    setHeaderRow(1);
    setMapping({});
    setOutcome(null);
  }

  async function readFile(chosen: File) {
    setBusy(true);
    setOutcome(null);
    try {
      const response = await fetch(
        `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/projects/${projectId}/boq-import/preview`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/octet-stream" },
          body: chosen,
        },
      );
      const body = (await response.json()) as { sheets?: SheetPreview[]; error?: string };
      if (!response.ok || !body.sheets) throw new Error(body.error ?? t.boqImport.readFailed);

      setFile(chosen);
      setSheets(body.sheets);
      const first = body.sheets[0];
      setSheetName(first?.name ?? "");
      setHeaderRow(first?.headerRow ?? 1);
      setMapping(first ? guessMapping(first, fieldLabels) : {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.boqImport.readFailed);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!file || !sheet) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set(
        "plan",
        JSON.stringify({ sheetName: sheet.name, headerRow, mapping: { fields: mapping } }),
      );

      const response = await fetch(
        `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/projects/${projectId}/boq-import/commit`,
        { method: "POST", credentials: "include", body },
      );
      const result = (await response.json()) as Outcome & { error?: string };

      if (response.status === 409 || (!response.ok && result.error)) {
        toast.error(result.error ?? t.common.somethingWentWrong);
        return;
      }

      setOutcome(result);
      if (result.status === "succeeded") {
        await queryClient.invalidateQueries(trpc.boq.pathFilter());
        await queryClient.invalidateQueries(trpc.progress.pathFilter());
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl" closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{t.boqImport.title}</DialogTitle>
          <DialogDescription>{t.boqImport.description}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {outcome === null && (
            <>
              <div className="space-y-2">
                <Label htmlFor="boq-import-file">{t.boqImport.chooseFile}</Label>
                <Input
                  id="boq-import-file"
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={busy}
                  onChange={(e) => {
                    const chosen = e.target.files?.[0];
                    if (chosen) void readFile(chosen);
                  }}
                />
                <p className="text-xs text-muted-foreground">{t.boqImport.fileHint}</p>
              </div>

              {busy && sheets === null && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="animate-spin" />
                  {t.boqImport.reading}
                </p>
              )}

              {sheets && sheets.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="boq-import-sheet">{t.boqImport.sheet}</Label>
                    <Select
                      items={sheets.map((candidate) => ({
                        value: candidate.name,
                        label: candidate.name,
                      }))}
                      value={sheetName}
                      onValueChange={(value) => {
                        const next = sheets.find((candidate) => candidate.name === value);
                        if (!next) return;
                        setSheetName(next.name);
                        setHeaderRow(next.headerRow);
                        setMapping(guessMapping(next, fieldLabels));
                      }}
                    >
                      <SelectTrigger id="boq-import-sheet" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sheets.map((candidate) => (
                          <SelectItem key={candidate.name} value={candidate.name}>
                            {candidate.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="boq-import-header">{t.boqImport.headerRow}</Label>
                    <Input
                      id="boq-import-header"
                      type="number"
                      min={1}
                      value={headerRow}
                      aria-describedby="boq-import-header-hint"
                      onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))}
                    />
                    <p id="boq-import-header-hint" className="text-xs text-muted-foreground">
                      {t.boqImport.headerRowHint}
                    </p>
                  </div>
                </div>
              )}

              {sheet && (
                <section className="space-y-2">
                  <div>
                    <h3 className="font-medium">{t.boqImport.columnsTitle}</h3>
                    <p className="text-xs text-muted-foreground">{t.boqImport.columnsHint}</p>
                  </div>

                  <ul className="divide-y rounded-lg border">
                    {sheet.columns.map((column) => {
                      const assigned = FIELDS.find((field) => mapping[field] === column.index);
                      const selectId = `map-${column.index}`;
                      return (
                        <li
                          key={column.index}
                          className="grid gap-2 p-2 sm:grid-cols-[1fr_12rem] sm:items-center"
                        >
                          <div className="min-w-0">
                            <Label htmlFor={selectId} className="block truncate">
                              {column.header ||
                                interpolate(t.boqImport.unnamedColumn, { letter: column.letter })}
                            </Label>
                            <p className="truncate text-xs text-muted-foreground">
                              {column.letter} · {column.samples.join(" · ") || "—"}
                            </p>
                          </div>
                          <Select
                            items={[
                              { value: NONE, label: t.boqImport.ignore },
                              ...FIELDS.map((field) => ({ value: field, label: fieldLabels[field] })),
                            ]}
                            value={assigned ?? NONE}
                            onValueChange={(value) =>
                              setMapping((current) => {
                                const next = { ...current };
                                // A field maps to exactly one column, so
                                // choosing it here takes it off whatever held it
                                // before rather than silently duplicating.
                                for (const field of FIELDS) {
                                  if (next[field] === column.index) delete next[field];
                                }
                                if (value && value !== NONE) next[value as Field] = column.index;
                                return next;
                              })
                            }
                          >
                            <SelectTrigger id={selectId} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>{t.boqImport.ignore}</SelectItem>
                              {FIELDS.map((field) => (
                                <SelectItem key={field} value={field}>
                                  {fieldLabels[field]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </li>
                      );
                    })}
                  </ul>

                  {mapping.description === undefined && (
                    <p role="status" className="text-xs font-medium text-destructive">
                      {t.boqImport.needsDescription}
                    </p>
                  )}
                </section>
              )}
            </>
          )}

          {outcome?.status === "failed" && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>
                {interpolate(t.boqImport.errorsTitle, { count: outcome.errors.length })}
              </AlertTitle>
              <AlertDescription>
                <p>{t.boqImport.errorsHint}</p>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {outcome.errors.slice(0, 50).map((error, index) => (
                    <li key={`${error.row}-${index}`} className="tabular-nums">
                      <span className="font-medium">
                        {interpolate(t.boqImport.errorRow, { row: error.row })}
                        {error.column
                          ? ` · ${interpolate(t.boqImport.errorColumn, { column: error.column })}`
                          : ""}
                      </span>{" "}
                      {error.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {outcome?.status === "succeeded" && (
            <Alert>
              <CheckCircle2 />
              <AlertTitle>
                {interpolate(t.boqImport.successTitle, { version: outcome.versionNo })}
              </AlertTitle>
              <AlertDescription>
                <p>
                  {interpolate(t.boqImport.successBody, {
                    lines: outcome.lineCount,
                    sections: outcome.sectionCount,
                    scheduled: outcome.scheduledCount,
                  })}
                </p>
                <p>{t.boqImport.successNext}</p>
              </AlertDescription>
            </Alert>
          )}

          <ImportHistory projectId={projectId} />
        </div>

        <DialogFooter>
          {outcome?.status === "failed" && (
            <Button
              variant="outline"
              onClick={() =>
                void downloadFromServer(
                  `/projects/${projectId}/boq-import/${outcome.importId}/errors.csv`,
                  "import-errors.csv",
                  t.common.somethingWentWrong,
                ).catch((error: unknown) =>
                  toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong),
                )
              }
            >
              <Download />
              {t.boqImport.downloadErrors}
            </Button>
          )}

          {outcome?.status === "succeeded" ? (
            <Button
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              {t.boqImport.done}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                {t.common.cancel}
              </Button>
              <Button disabled={!canImport || busy} onClick={() => void runImport()}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {busy ? t.boqImport.importing : t.boqImport.importAction}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A first guess at the mapping from the header text.
 *
 * Matched against both dictionaries' field names plus the vocabulary these
 * workbooks actually use, so an Indonesian sheet lands mapped whichever
 * language the app is in. It is only a starting point — every choice is visible
 * and changeable before anything is imported.
 */
function guessMapping(
  sheet: SheetPreview,
  labels: Record<Field, string>,
): Partial<Record<Field, number>> {
  const hints: Record<Field, string[]> = {
    code: ["code", "kode", "no.", "no"],
    description: ["description", "uraian", "pekerjaan", "item", "deskripsi"],
    parent: ["section", "bagian", "parent", "kelompok"],
    unit: ["unit", "satuan", "sat"],
    quantity: ["quantity", "volume", "qty", "vol"],
    unitRate: ["rate", "harga satuan", "harga", "unit price"],
    weight: ["weight", "bobot"],
    start: ["start", "mulai", "awal"],
    finish: ["finish", "selesai", "akhir", "end"],
  };

  const mapping: Partial<Record<Field, number>> = {};
  const taken = new Set<number>();

  for (const field of FIELDS) {
    const needles = [labels[field].toLowerCase(), ...hints[field]];
    const match = sheet.columns.find((column) => {
      if (taken.has(column.index)) return false;
      const header = column.header.trim().toLowerCase();
      if (header === "") return false;
      return needles.some((needle) => header === needle || header.includes(needle));
    });
    if (match) {
      mapping[field] = match.index;
      taken.add(match.index);
    }
  }

  return mapping;
}

/**
 * What has been imported into this project before — filename, who ran it, and
 * how it went. The record is kept whether the import succeeded or failed, so
 * this is also where a failed attempt's error report is still reachable from.
 */
function ImportHistory({ projectId }: { projectId: string }) {
  const t = useT();
  const query = useQuery(trpc.boq.listImports.queryOptions({ projectId, limit: 5 }));
  const data = query.data;

  return (
    <section className="space-y-2">
      <h3 className="font-medium">{t.boqImport.history}</h3>
      {query.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : query.isError ? (
        <QueryError
          error={query.error}
          onRetry={() => void query.refetch()}
          className="px-3 py-4"
        />
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.boqImport.historyEmpty}</p>
      ) : (
        <ul className="divide-y rounded-lg border text-xs">
          {data.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 p-2">
              <span className="font-medium">{entry.filename}</span>
              <span className="text-muted-foreground">
                {interpolate(t.boqImport.importedBy, {
                  name: entry.importedByName,
                  count: entry.rowsImported,
                })}
              </span>
              <span
                className={`ml-auto font-medium ${
                  entry.status === "failed" ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {entry.status === "failed"
                  ? t.boqImport.statusFailed
                  : t.boqImport.statusSucceeded}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
