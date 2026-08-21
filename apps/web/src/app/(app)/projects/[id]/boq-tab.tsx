"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@DashboardV2/ui/components/alert-dialog";
import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@DashboardV2/ui/components/empty";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ListChecks, Lock, Pencil, Plus, Scale, Trash2 } from "@DashboardV2/ui/components/icons";
import { Fragment, useState } from "react";
import { toast } from "@/lib/toast";

import { QueryError } from "@/components/query-error";
import { interpolate, plural } from "@/i18n";
import { Hint } from "@/components/hint";
import { useT } from "@/i18n/provider";
import { buildSections, sectionAmount, sectionWeight, totalLeafWeight } from "@/lib/boq/curves";
import { BulkActionsBar } from "@/components/bulk-actions-bar";
import { SelectAllHead, SelectRowCell, ToolbarAction } from "@/components/table-selection";
import { summarizeSelection } from "@/lib/summarize-selection";
import { useRowSelection } from "@/lib/use-row-selection";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import BoqItemDialog, { EMPTY_BOQ_ITEM, type BoqItemFormValues } from "./boq-item-dialog";

/** How far the weights may sit from 100% and still be baselined. */
const WEIGHT_TOLERANCE = 0.5;

type DialogTarget = {
  parentId: string | null;
  editingId: string | null;
  initialValues: BoqItemFormValues;
};

export default function BoqTab({
  projectId,
  canEdit,
  targetVersionId,
  setupMode = false,
  onContinue,
}: {
  projectId: string;
  canEdit: boolean;
  targetVersionId?: string;
  setupMode?: boolean;
  onContinue?: () => void;
}) {
  const t = useT();
  const { money, quantity } = useFormat();
  const queryClient = useQueryClient();

  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const boqQuery = useQuery(
    trpc.boq.overview.queryOptions({
      projectId,
      versionId: targetVersionId ?? selectedVersionId ?? undefined,
    }),
  );
  const versionsQuery = useQuery(trpc.boq.listVersions.queryOptions({ projectId }));
  const createDraft = useMutation(trpc.boq.getOrCreateDraft.mutationOptions());
  const recalcWeights = useMutation(trpc.boq.recalcWeights.mutationOptions());
  const deleteItems = useMutation(trpc.boq.deleteItems.mutationOptions());
  const reorder = useMutation(trpc.boq.reorderItems.mutationOptions());

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries(trpc.boq.pathFilter()),
      queryClient.invalidateQueries(trpc.progress.pathFilter()),
      queryClient.invalidateQueries(trpc.project.pathFilter()),
    ]);
  }

  async function run(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action();
      await refresh();
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    }
  }

  // Above the early returns: this component has three of them, and a hook that
  // only ran on the happy path would change the hook order between renders.
  // Selection is over the flat item list, so "select all" covers sections and
  // lines alike.
  const allItems = boqQuery.data?.items ?? [];
  const selection = useRowSelection(allItems, {
    getId: (item) => item.id,
    resetKey: boqQuery.data?.version?.id ?? "",
  });

  if (boqQuery.isPending || versionsQuery.isPending) return <Skeleton className="h-64 w-full" />;
  if (boqQuery.isError || versionsQuery.isError) {
    return (
      <QueryError
        error={boqQuery.error ?? versionsQuery.error}
        onRetry={() => void Promise.all([boqQuery.refetch(), versionsQuery.refetch()])}
      />
    );
  }

  const version = boqQuery.data?.version ?? null;
  const items = allItems;
  const versions = versionsQuery.data ?? [];
  const versionOptions = versions.map((candidate) => ({
    value: candidate.id,
    label: `${interpolate(t.boq.revision, { number: candidate.versionNo })} - ${
      candidate.status === "draft"
        ? t.boq.draft
        : candidate.status === "active"
          ? t.boq.active
          : t.boq.superseded
    }`,
  }));

  if (!version) {
    return (
      <Card>
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t.boq.title}</EmptyTitle>
            </EmptyHeader>
            {canEdit && (
              <Button
                onClick={() => void run(() => createDraft.mutateAsync({ projectId }), t.boq.saved)}
                disabled={createDraft.isPending}
              >
                <Plus />
                {t.boq.createDraft}
              </Button>
            )}
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const versionId = version.id;
  const isDraft = version.status === "draft";
  const editable = canEdit && isDraft;
  const hasDraft = versions.some((candidate) => candidate.status === "draft");
  const sections = buildSections(items);
  /**
   * Lines that will go with the sections ticked, without being ticked
   * themselves.
   *
   * Deleting a section cascades to everything under it — that is the whole
   * point of the recursive delete — so a confirmation that only counts the
   * checkboxes understates what is about to happen. This is the difference,
   * and it is what the dialog reports.
   */
  const cascadedLineCount = sections
    .filter((section) => selection.isSelected(section.header.id))
    .flatMap((section) => section.leaves)
    .filter((leaf) => !selection.isSelected(leaf.id)).length;

  async function confirmBulkDelete() {
    const ids = selection.selectedIds;
    if (ids.length === 0 || !version) return;
    try {
      const result = await deleteItems.mutateAsync({ versionId: version.id, ids });
      await refresh();
      toast.success(plural(t.boq.bulkDeletedToast, result.count));
      selection.clear();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.bulkDeleteFailed);
    }
  }

  const weightTotal = totalLeafWeight(items);
  const weightsReady = Math.abs(weightTotal - 100) <= WEIGHT_TOLERANCE;

  /** Moves an item within its own group of siblings. */
  function move(siblingIds: string[], id: string, direction: -1 | 1) {
    const from = siblingIds.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= siblingIds.length) return;

    const next = [...siblingIds];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);

    void run(() => reorder.mutateAsync({ versionId, orderedIds: next }), t.boq.saved);
  }

  const sectionIds = sections.map((section) => section.header.id);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                {interpolate(t.boq.revision, { number: version.versionNo })}
                <Badge variant={isDraft ? "outline" : "secondary"}>
                  {isDraft
                    ? t.boq.draft
                    : version.status === "active"
                      ? t.boq.active
                      : t.boq.superseded}
                </Badge>
                {!isDraft && (
                  <Hint text={t.boq.lockedNote} className="text-muted-foreground" />
                )}
                {isDraft && !weightsReady && <Hint text={t.boq.weightsIncompleteHint} />}
              </CardTitle>
            </div>

            <div className="flex flex-wrap gap-2">
              {!setupMode && versions.length > 1 && (
                <Select
                  items={versionOptions}
                  value={version.id}
                  onValueChange={(value) => setSelectedVersionId(value ?? null)}
                >
                  <SelectTrigger size="sm" className="w-36" aria-label={t.boq.history}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {versionOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {!setupMode && canEdit && version.status === "active" && !hasDraft && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={createDraft.isPending}
                  onClick={() => {
                    setSelectedVersionId(null);
                    void run(() => createDraft.mutateAsync({ projectId }), t.boq.revisionCreated);
                  }}
                >
                  <Pencil />
                  {t.boq.revise}
                </Button>
              )}
              {editable && (
                <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={recalcWeights.isPending}
                  onClick={() =>
                    void run(
                      () => recalcWeights.mutateAsync({ versionId: version.id }),
                      t.boq.weightsRecalculated,
                    )
                  }
                >
                  <Scale />
                  {t.boq.recalcWeights}
                </Button>
                </>
              )}
              {setupMode && onContinue && (
                <Button size="sm" disabled={items.length === 0} onClick={onContinue}>
                  {t.baseline.continueSchedule}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

      </Card>

      <Card>
        <CardContent className="px-0">
          {/*
           * table-fixed with scrollX off: the seven narrow columns keep their
           * declared widths and the description takes what is left, wrapping
           * rather than pushing the table past the card. Codes truncate for the
           * same reason — a long one used to set a min-content floor that the
           * whole table had to widen to satisfy.
           */}
          {editable && (
            <div className="px-4 pb-2">
              <BulkActionsBar count={selection.selectedCount} onClear={selection.clear}>
                {/* Edit is a single-row action, so it is offered only when the
                    selection is one row. A bulk edit form for BoQ lines would
                    have to invent semantics for "set the quantity of twelve
                    different lines", which is not a thing anyone asked for. */}
                <ToolbarAction
                  icon={<Pencil />}
                  label={t.boq.editSelected}
                  disabled={selection.selectedCount !== 1}
                  onClick={() => {
                    const target = items.find((item) => item.id === selection.selectedIds[0]);
                    if (!target) return;
                    setDialog({
                      parentId: target.parentId,
                      editingId: target.id,
                      initialValues: toFormValues(target),
                    });
                  }}
                />
                <ToolbarAction
                  icon={<Trash2 />}
                  variant="destructive"
                  label={plural(t.boq.deleteSelectedLabel, selection.selectedCount)}
                  onClick={() => setBulkDeleteOpen(true)}
                />
              </BulkActionsBar>
            </div>
          )}
          <Table className="min-w-[48rem] table-fixed">
            <TableHeader>
              <TableRow>
                {editable && <SelectAllHead selection={selection} />}
                <TableHead className={editable ? "w-24" : "w-24 pl-4"}>{t.boq.code}</TableHead>
                <TableHead>{t.boq.description}</TableHead>
                <TableHead className="w-16">{t.boq.unit}</TableHead>
                <TableHead className="w-28 text-right">{t.boq.quantity}</TableHead>
                <TableHead className="w-32 text-right">{t.boq.unitRate}</TableHead>
                <TableHead className="w-36 text-right">{t.boq.amount}</TableHead>
                <TableHead className="w-20 text-right">{t.boq.weight}</TableHead>
                {editable && <TableHead className="pr-4 w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sections.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editable ? 9 : 7}>
                    <Empty className="border-0 py-6">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <ListChecks />
                        </EmptyMedia>
                        <EmptyTitle>{t.boq.empty}</EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}

              {sections.map((section) => {
                const leafIds = section.leaves.map((leaf) => leaf.id);

                return (
                  <Fragment key={section.header.id}>
                    <TableRow
                      className="bg-muted/40"
                      data-state={
                        selection.isSelected(section.header.id) ? "selected" : undefined
                      }
                    >
                      {editable && (
                        <SelectRowCell
                          selection={selection}
                          id={section.header.id}
                          name={section.header.code}
                        />
                      )}
                      <TableCell
                        className={`truncate font-mono font-medium ${editable ? "" : "pl-4"}`}
                      >
                        {section.header.code}
                      </TableCell>
                      <TableCell className="font-medium">{section.header.description}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {section.leaves.length === 0 ? (section.header.unit ?? "—") : ""}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                        {section.leaves.length === 0 && section.header.quantity !== null
                          ? quantity(section.header.quantity)
                          : ""}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                        {section.leaves.length === 0 && section.header.unitRate !== null
                          ? money(section.header.unitRate)
                          : ""}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                        {money(sectionAmount(section))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {sectionWeight(section).toFixed(2)}%
                      </TableCell>
                      {editable && (
                        <TableCell className="pr-4">
                          <div className="flex justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={t.boq.addLine}
                              onClick={() =>
                                setDialog({
                                  parentId: section.header.id,
                                  editingId: null,
                                  initialValues: EMPTY_BOQ_ITEM,
                                })
                              }
                            >
                              <Plus />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={t.boq.moveUp}
                              onClick={() => move(sectionIds, section.header.id, -1)}
                            >
                              <ChevronUp />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={t.boq.moveDown}
                              onClick={() => move(sectionIds, section.header.id, 1)}
                            >
                              <ChevronDown />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>

                    {section.leaves.map((leaf) => (
                      <TableRow
                        key={leaf.id}
                        data-state={selection.isSelected(leaf.id) ? "selected" : undefined}
                      >
                        {editable && (
                          <SelectRowCell selection={selection} id={leaf.id} name={leaf.code} />
                        )}
                        <TableCell className="truncate pl-8 font-mono text-muted-foreground">
                          {leaf.code}
                        </TableCell>
                        <TableCell>{leaf.description}</TableCell>
                        <TableCell className="text-muted-foreground">{leaf.unit ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {leaf.quantity === null ? "—" : quantity(leaf.quantity)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {leaf.unitRate === null ? "—" : money(leaf.unitRate)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {money(leaf.value ?? 0)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {leaf.weight.toFixed(2)}%
                        </TableCell>
                        {editable && (
                          <TableCell className="pr-4">
                            <div className="flex justify-end gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t.boq.moveUp}
                                onClick={() => move(leafIds, leaf.id, -1)}
                              >
                                <ChevronUp />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t.boq.moveDown}
                                onClick={() => move(leafIds, leaf.id, 1)}
                              >
                                <ChevronDown />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editable && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setDialog({ parentId: null, editingId: null, initialValues: EMPTY_BOQ_ITEM })
          }
        >
          <Plus />
          {sections.length === 0 ? t.boq.addFirstSection : t.boq.addSection}
        </Button>
      )}

      {dialog && (
        <BoqItemDialog
          key={`${dialog.editingId ?? "new"}-${dialog.parentId ?? "root"}`}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          versionId={version.id}
          parentId={dialog.parentId}
          editingId={dialog.editingId}
          initialValues={dialog.initialValues}
        />
      )}

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {plural(t.common.bulkDeleteTitle, selection.selectedCount)}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">{t.boq.bulkDeleteDescription}</span>
              <span className="block font-medium text-foreground">
                {summarizeSelection(
                  selection.selectedRows.map((item) => `${item.code} - ${item.description}`),
                  t,
                )}
              </span>
              {/* The cascade, stated. Ticking one section can remove twenty
                  rows, and a count of the checkboxes would not say so. */}
              {cascadedLineCount > 0 && (
                <span className="block">
                  {interpolate(t.boq.bulkDeleteCascade, { count: cascadedLineCount })}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setBulkDeleteOpen(false);
                void confirmBulkDelete();
              }}
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function toFormValues(item: {
  code: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  unitRate: number | null;
  progressMode: "by_quantity" | "by_percent";
}): BoqItemFormValues {
  return {
    code: item.code,
    description: item.description,
    unit: item.unit ?? "",
    quantity: item.quantity ?? 0,
    unitRate: item.unitRate ?? 0,
    progressMode: item.progressMode,
  };
}
