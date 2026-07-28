"use client";

import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Empty, EmptyHeader, EmptyTitle } from "@DashboardV2/ui/components/empty";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@DashboardV2/ui/components/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { DeviationBadge } from "@/components/deviation-badge";
import { Meter } from "@/components/meter";
import { StatusBadge } from "@/components/status-badge";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import BaselineTab from "./baseline-tab";
import NotesTab from "./notes-tab";
import ProgressTab from "./progress-tab";
import TicketsTab from "./tickets-tab";

export default function ProjectDetail({
  projectId,
  isAdmin,
}: {
  projectId: string;
  isAdmin: boolean;
}) {
  const t = useT();
  const { money, percent, quantity, formatDate } = useFormat();
  const queryClient = useQueryClient();

  const projectQuery = useQuery(trpc.project.get.queryOptions({ id: projectId }));
  const expensesQuery = useQuery(trpc.expense.listByProject.queryOptions({ projectId }));
  const movementsQuery = useQuery(trpc.material.listMovements.queryOptions({ projectId, limit: 50 }));

  const deleteExpense = useMutation(trpc.expense.delete.mutationOptions());

  const project = projectQuery.data;

  if (projectQuery.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!project) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t.projects.notFound}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t.projects.allProjects}
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{project.name}</h1>
            <StatusBadge kind="project" value={project.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{project.code}</span>
            {project.client && ` · ${project.client}`}
            {project.location && ` · ${project.location}`}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t.projects.contractValueTile}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold tabular-nums">
              {project.contractValue === null ? "—" : money(project.contractValue)}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t.projects.workCompleted}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xl font-semibold tabular-nums">
              {project.workCompletedValue === null ? "—" : money(project.workCompletedValue)}
            </p>
            {project.workCompletedValue !== null && project.contractValue !== null && (
              <Meter
                value={project.workCompletedValue}
                max={project.contractValue}
                label={percent(project.valueCompletionPercent)}
              />
            )}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t.projects.remainingContractValue}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold tabular-nums">
              {project.remainingContractValue === null
                ? "—"
                : money(project.remainingContractValue)}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t.projects.siteProgress}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xl font-semibold tabular-nums">
              {project.progressPercent.toFixed(project.progressSource === "boq" ? 1 : 0)}%
            </p>
            <Meter value={project.progressPercent} max={100} />
            {/* With a baseline the figure is measured; without one there is no
                physical-progress source to report. */}
            {project.progressSource === "boq" ? (
              <div className="space-y-0.5">
                <DeviationBadge value={project.deviation} className="text-xs" />
                <p className="text-xs text-muted-foreground">
                  {project.dataDate
                    ? interpolate(t.projects.asOf, { date: formatDate(project.dataDate) })
                    : t.projects.progressFromBoq}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t.projects.noBaselineYet}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Detail label={t.projects.startDate} value={formatDate(project.startDate)} />
        <Detail label={t.projects.targetCompletion} value={formatDate(project.endDate)} />
        <Detail label={t.projects.manager} value={project.manager?.name ?? t.common.unassigned} />
      </div>

      <Tabs defaultValue="tickets">
        <TabsList>
          <TabsTrigger value="tickets">{t.projects.tabTickets}</TabsTrigger>
          <TabsTrigger value="baseline">{t.projects.tabBaseline}</TabsTrigger>
          <TabsTrigger value="progress">{t.projects.tabProgress}</TabsTrigger>
          <TabsTrigger value="expenses">{t.projects.tabExpenses}</TabsTrigger>
          <TabsTrigger value="materials">{t.projects.tabMaterials}</TabsTrigger>
          <TabsTrigger value="notes">{t.notes.tab}</TabsTrigger>
        </TabsList>

        <TabsContent value="baseline">
          <BaselineTab projectId={projectId} isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="progress">
          <ProgressTab projectId={projectId} isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="tickets">
          <TicketsTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="expenses">
          <Card>
            <CardHeader>
              <CardTitle>{t.expenses.recordedExpenses}</CardTitle>
              <CardDescription>
                {interpolate(t.expenses.summary, {
                  total: money(expensesQuery.data?.total ?? 0),
                  count: expensesQuery.data?.expenses.length ?? 0,
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">{t.expenses.description}</TableHead>
                    <TableHead>{t.expenses.category}</TableHead>
                    <TableHead>{t.expenses.date}</TableHead>
                    <TableHead className="text-right">{t.expenses.amount}</TableHead>
                    {isAdmin && <TableHead className="pr-4" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(expensesQuery.data?.expenses.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={isAdmin ? 5 : 4}
                        className="py-10 text-center text-muted-foreground"
                      >
                        {t.expenses.empty}
                      </TableCell>
                    </TableRow>
                  )}
                  {(expensesQuery.data?.expenses ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="pl-4 font-medium">{row.description}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{t.expenses.categories[row.category]}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.incurredOn)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.amount)}</TableCell>
                      {isAdmin && (
                        <TableCell className="pr-4 text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={interpolate(t.expenses.deleteAria, {
                              description: row.description,
                            })}
                            onClick={async () => {
                              try {
                                 await deleteExpense.mutateAsync({ id: row.id });
                                 await queryClient.invalidateQueries(trpc.expense.pathFilter());
                                 toast.success(t.expenses.deleted);
                              } catch (error) {
                                toast.error(
                                  error instanceof Error ? error.message : t.expenses.deleteFailed,
                                );
                              }
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="materials">
          <Card>
            <CardHeader>
              <CardTitle>{t.projects.tabMaterials}</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">{t.materials.material}</TableHead>
                    <TableHead>{t.materials.movement}</TableHead>
                    <TableHead className="text-right">{t.materials.quantity}</TableHead>
                    <TableHead>{t.materials.dateLabel}</TableHead>
                    <TableHead className="pr-4">{t.materials.recordedBy}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(movementsQuery.data?.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                        {t.materials.emptyMovements}
                      </TableCell>
                    </TableRow>
                  )}
                  {(movementsQuery.data ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="pl-4 font-medium">{row.materialName}</TableCell>
                      <TableCell>
                        <Badge variant={row.type === "out" ? "secondary" : "outline"}>
                          {row.type === "out"
                            ? t.materials.issued
                            : row.type === "in"
                              ? t.materials.received
                              : t.materials.adjusted}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {quantity(Number(row.quantity), row.materialUnit)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.occurredOn)}
                      </TableCell>
                      <TableCell className="pr-4 text-muted-foreground">
                        {row.recordedByName ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <NotesTab projectId={projectId} isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}
