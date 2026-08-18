"use client";

import type { AppRouter } from "@DashboardV2/api/routers/index";
import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@DashboardV2/ui/components/dropdown-menu";
import {
  CalendarRange,
  ListChecks,
  Loader2,
  MoreHorizontal,
} from "@DashboardV2/ui/components/icons";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import { useState } from "react";

import { Meter } from "@/components/meter";
import { QueryError } from "@/components/query-error";
import { StatusBadge, useStatusLabel } from "@/components/status-badge";
import { interpolate, plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import { PROJECT_STATUSES } from "./project-form-values";

const BOARD_PAGE_SIZE = 10;

type ProjectStatus = (typeof PROJECT_STATUSES)[number];
type ProjectRow = inferRouterOutputs<AppRouter>["project"]["list"]["projects"][number];

export function ProjectsBoard({
  search,
  status,
  canUpdate,
}: {
  search: string;
  status: ProjectStatus | "all";
  canUpdate: boolean;
}) {
  const t = useT();
  const statusLabel = useStatusLabel();
  const queryClient = useQueryClient();
  const updateProject = useMutation(trpc.project.update.mutationOptions());
  const [movingId, setMovingId] = useState<string | null>(null);
  const visibleStatuses = status === "all" ? PROJECT_STATUSES : [status];

  async function moveProject(row: ProjectRow, nextStatus: ProjectStatus) {
    if (row.status === nextStatus) return;
    setMovingId(row.id);
    try {
      await updateProject.mutateAsync({ id: row.id, status: nextStatus });
      await queryClient.invalidateQueries(trpc.project.pathFilter());
      toast.success(
        interpolate(t.projects.statusChanged, {
          name: row.name,
          status: statusLabel("project", nextStatus),
        }),
      );
      requestAnimationFrame(() => {
        const target =
          document.getElementById(`project-board-link-${row.id}`) ??
          document.getElementById(`project-board-${nextStatus}`) ??
          document.getElementById(`project-board-${row.status}`);
        target?.focus();
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.projects.statusChangeFailed,
      );
    } finally {
      setMovingId(null);
    }
  }

  return (
    <div
      className="grid gap-3 md:grid-flow-col md:auto-cols-[minmax(17rem,1fr)] md:grid-cols-none md:items-start md:overflow-x-auto md:pb-2"
    >
      {visibleStatuses.map((columnStatus) => (
        <ProjectBoardColumn
          key={columnStatus}
          status={columnStatus}
          search={search}
          canUpdate={canUpdate}
          movingId={movingId}
          movePending={updateProject.isPending}
          onMove={moveProject}
        />
      ))}
    </div>
  );
}

function ProjectBoardColumn({
  status,
  search,
  canUpdate,
  movingId,
  movePending,
  onMove,
}: {
  status: ProjectStatus;
  search: string;
  canUpdate: boolean;
  movingId: string | null;
  movePending: boolean;
  onMove: (row: ProjectRow, status: ProjectStatus) => Promise<void>;
}) {
  const t = useT();
  const statusLabel = useStatusLabel();
  const query = useInfiniteQuery(
    trpc.project.list.infiniteQueryOptions(
      { search, status, limit: BOARD_PAGE_SIZE },
      { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
    ),
  );
  const projects = query.data?.pages.flatMap((page) => page.projects) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  const label = statusLabel("project", status);
  const headingId = `project-board-${status}`;

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={query.isPending || query.isFetchingNextPage}
      className="min-w-0 rounded-lg bg-muted/40 p-2 ring-1 ring-foreground/10 md:w-[17rem]"
    >
      <p role="status" aria-live="polite" className="sr-only">
        {query.isFetchingNextPage
          ? t.common.loadingMore
          : projects.length > 0
            ? interpolate(t.common.loadedCount, { count: projects.length, total })
            : ""}
      </p>
      <div className="flex min-h-9 items-center justify-between gap-2 px-1 pb-2">
        <h2 id={headingId} tabIndex={-1} className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatusBadge kind="project" value={status} />
        </h2>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {plural(t.projects.boardProjectCount, total)}
        </span>
      </div>

      <div className="space-y-2">
        {query.isPending &&
          Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-36 animate-pulse rounded-lg bg-card ring-1 ring-foreground/10" />
          ))}

        {query.isError && query.data === undefined && (
          <QueryError
            error={new Error(interpolate(t.projects.boardColumnFailed, { status: label }))}
            onRetry={() => void query.refetch()}
            className="bg-card px-3 py-8"
          />
        )}

        {!query.isPending && !query.isError && projects.length === 0 && (
          <div className="rounded-lg border border-dashed bg-card px-4 py-8 text-center text-xs text-muted-foreground">
            {t.projects.boardEmpty}
          </div>
        )}

        {projects.map((row) => (
          <ProjectBoardCard
            key={row.id}
            row={row}
            canUpdate={canUpdate}
            moving={movingId === row.id}
            movePending={movePending}
            onMove={onMove}
          />
        ))}
      </div>

      {projects.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 py-1">
          <span className="text-xs tabular-nums text-muted-foreground">
            {interpolate(t.common.loadedCount, { count: projects.length, total })}
          </span>
          {query.hasNextPage && (
            <Button
              variant="outline"
              size="xs"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage && <Loader2 className="animate-spin" />}
              {query.isFetchingNextPage
                ? t.common.loadingMore
                : query.isFetchNextPageError
                  ? t.common.retry
                  : t.common.loadMore}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function ProjectBoardCard({
  row,
  canUpdate,
  moving,
  movePending,
  onMove,
}: {
  row: ProjectRow;
  canUpdate: boolean;
  moving: boolean;
  movePending: boolean;
  onMove: (row: ProjectRow, status: ProjectStatus) => Promise<void>;
}) {
  const t = useT();
  const { formatDate, percent } = useFormat();
  const statusLabel = useStatusLabel();
  const menuLabel = interpolate(t.projects.changeStatusLabel, { name: row.name });

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle as="h3" className="min-w-0">
          <Link
            id={`project-board-link-${row.id}`}
            href={`/projects/${row.id}`}
            className="block truncate hover:underline"
          >
            {row.name}
          </Link>
        </CardTitle>
        <p className="truncate font-mono text-muted-foreground">{row.code}</p>
        {canUpdate && (
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={menuLabel}
                    title={menuLabel}
                    disabled={movePending}
                  />
                }
              >
                {moving ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 bg-card">
                <DropdownMenuRadioGroup
                  value={row.status}
                  onValueChange={(status) => void onMove(row, status as ProjectStatus)}
                >
                  {PROJECT_STATUSES.map((status) => (
                    <DropdownMenuRadioItem key={status} value={status}>
                      {statusLabel("project", status)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="truncate text-muted-foreground">{row.client ?? "—"}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarRange className="size-3.5" />
            {formatDate(row.endDate)}
          </span>
          {row.openTickets > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListChecks className="size-3.5" />
              {plural(t.projects.openActionsCount, row.openTickets)}
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-muted-foreground">
            <span>{t.projects.progressMeter}</span>
            <span className="tabular-nums">{percent(row.progressPercent)}</span>
          </div>
          <Meter
            value={row.progressPercent}
            max={100}
            segments={8}
            ariaLabel={interpolate(t.projects.progressFor, { name: row.name })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
