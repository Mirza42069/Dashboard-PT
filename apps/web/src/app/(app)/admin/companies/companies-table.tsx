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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { interpolate } from "@/i18n";
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
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.company.name}</TableHead>
                  <TableHead>{t.company.code}</TableHead>
                  <TableHead className="text-right">{t.nav.users}</TableHead>
                  <TableHead>{t.company.created}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((row) => {
                  const owned = row.projects + row.materials + row.equipment + row.users;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.code}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.users}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t.company.edit}
                            onClick={() =>
                              setEditing({ id: row.id, name: row.name, code: row.code })
                            }
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t.company.delete}
                            // Server refuses this too; disabling explains why up front.
                            disabled={owned > 0 || companies.length <= 1}
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
