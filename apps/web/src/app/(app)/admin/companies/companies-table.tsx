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
import { Card, CardContent } from "@DashboardV2/ui/components/card";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";
import { Popover, PopoverContent, PopoverTrigger } from "@DashboardV2/ui/components/popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Pencil, Trash2 } from "@DashboardV2/ui/components/icons";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { interpolate, plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import CompanyFormDialog, { type CompanyDraft } from "./company-form-dialog";

type PendingDelete = { id: string; name: string };

export default function CompaniesTable() {
  const t = useT();
  const { formatDateTime } = useFormat();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<CompanyDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const companiesQuery = useQuery(trpc.company.list.queryOptions());
  const deleteCompany = useMutation(trpc.company.delete.mutationOptions());

  const companies = companiesQuery.data?.companies ?? [];

  async function refresh() {
    // The switcher and every scoped list read from these, so refresh broadly.
    await queryClient.invalidateQueries();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteCompany.mutateAsync({ id: pendingDelete.id });
      await refresh();
      toast.success(t.company.deleted);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <CompanyFormDialog
          key={editing?.id ?? "new"}
          draft={editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSaved={refresh}
        />
      </div>

      {companiesQuery.isPending && <Skeleton className="h-48 w-full" />}

      {!companiesQuery.isPending && companies.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t.company.empty}
          </CardContent>
        </Card>
      )}

      {companies.length > 0 && (
        <Card>
          {/* px-0, not overflow-x-auto: Table brings its own scroll container
              (and the shadow affordance painted on it), so a second one here
              could never scroll and only hid those shadows. */}
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.company.name}</TableHead>
                  <TableHead>{t.company.code}</TableHead>
                  <TableHead>{t.company.vertical}</TableHead>
                  <TableHead>{t.nav.users}</TableHead>
                  <TableHead>{t.company.created}</TableHead>
                  {/* Wide enough for the two actions plus the blocked marker. */}
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((row) => {
                  // Why the delete is refused, or null when it is allowed. The
                  // button's disabled state comes from this same value so the
                  // two can't disagree — and it is worth spelling out, because
                  // the row shows a user count while the rule also counts
                  // projects: a company reading "0" here can still be
                  // undeletable, which looks like a broken button otherwise.
                  const blockedReason = (() => {
                    if (companies.length <= 1) return t.company.deleteBlockedLast;
                    const projects =
                      row.projects > 0 ? plural(t.company.projectCount, row.projects) : null;
                    const users = row.users > 0 ? plural(t.company.userCount, row.users) : null;
                    const patients =
                      row.patients > 0 ? plural(t.company.patientCount, row.patients) : null;
                    const practitioners =
                      row.practitioners > 0
                        ? plural(t.company.practitionerCount, row.practitioners)
                        : null;
                    const dentalOwners = [patients, practitioners].filter(Boolean).join(", ");
                    if (dentalOwners) {
                      const other = [projects, users].filter(Boolean).join(", ");
                      return interpolate(t.company.deleteBlockedDental, {
                        dental: dentalOwners,
                        other: other ? `, ${other}` : "",
                      });
                    }
                    if (projects && users) {
                      return interpolate(t.company.deleteBlockedBoth, { projects, users });
                    }
                    if (projects) return interpolate(t.company.deleteBlockedProjects, { projects });
                    if (users) return interpolate(t.company.deleteBlockedUsers, { users });
                    return null;
                  })();
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.code}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.vertical === "dental" ? "secondary" : "outline"}>
                          {row.vertical === "dental"
                            ? t.company.verticalDental
                            : t.company.verticalConstruction}
                        </Badge>
                      </TableCell>
                      {/* Left, against the usual right-align-numbers rule, and
                          deliberately: a left-aligned Created column sits
                          immediately after it, so right-aligning pushed the
                          count hard against the date and it read as part of it.
                          tabular-nums still keeps the digits in a column. */}
                      <TableCell className="tabular-nums whitespace-nowrap">{row.users}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {/* Only rendered on rows where delete is actually
                              refused, and placed ahead of the buttons: the group
                              is right-aligned, so growing it leftwards keeps the
                              edit and delete icons on the same vertical line as
                              every other row.

                              The popup opens above the marker rather than beside
                              it. Beside meant vertically centred on a 28px
                              button, so a two-line reason straddled the row
                              boundary and read as belonging to the row below.
                              Above clears the row entirely, and align="end"
                              hangs it from the marker's right edge so a max-w-xs
                              panel cannot run off the left on a narrow screen.

                              It carries the explanation itself rather than
                              hanging the popup off the disabled button, because
                              a disabled button emits no pointer events — nothing
                              anchored to it would ever open.

                              A popover, not a tooltip: Base UI disables tooltips
                              on touch devices, so on a tablet the reason this
                              marker exists to give would simply never appear.
                              `openOnHover` keeps the pointer behaviour a tooltip
                              would have had. */}
                          {blockedReason && (
                            <Popover>
                              <PopoverTrigger
                                openOnHover
                                // Base UI defaults this to 300ms, which reads as
                                // the marker ignoring the pointer entirely. 0
                                // matches TooltipProvider's delay, so this opens
                                // as immediately as every other hover popup here.
                                delay={0}
                                render={
                                  <button
                                    type="button"
                                    aria-label={blockedReason}
                                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                                  >
                                    <CircleAlert className="size-4" aria-hidden />
                                  </button>
                                }
                              />
                              <PopoverContent side="top" align="end">
                                {blockedReason}
                              </PopoverContent>
                            </Popover>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t.company.edit}
                            onClick={() =>
                              setEditing({
                                id: row.id,
                                name: row.name,
                                code: row.code,
                                vertical: row.vertical,
                              })
                            }
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t.company.delete}
                            // Server refuses this too; disabling explains why up
                            // front, and the marker to the left says which rule.
                            disabled={blockedReason !== null}
                            onClick={() => setPendingDelete({ id: row.id, name: row.name })}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.company.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {interpolate(t.company.deleteConfirm, { name: pendingDelete?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>
              {t.company.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
