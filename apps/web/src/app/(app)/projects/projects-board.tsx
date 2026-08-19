"use client";

import type { AppRouter } from "@DashboardV2/api/routers/index";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
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
import { useEffect, useState } from "react";

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
  const [draggedRow, setDraggedRow] = useState<ProjectRow | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const visibleStatuses = status === "all" ? PROJECT_STATUSES : [status];

  /*
   * A distance threshold, not an instant grab: the card title is a link, and
   * without it every click would be swallowed as a drag that never happened.
   * No touch or keyboard sensor on purpose — the per-card status menu is
   * already a complete keyboard path, and a second one would fight its focus
   * restoration.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function draggedFrom(event: DragStartEvent | DragEndEvent) {
    return (event.active.data.current as { row?: ProjectRow } | undefined)?.row ?? null;
  }

  function handleDragEnd(event: DragEndEvent) {
    const row = draggedFrom(event);
    setDraggedRow(null);
    if (!row || !event.over) return;
    void moveProject(row, event.over.id as ProjectStatus);
  }

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

  const columns = (
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

  // Nothing to drag if this account cannot change a project's status.
  if (!canUpdate) return columns;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => setDraggedRow(draggedFrom(event))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggedRow(null)}
      /*
       * dnd-kit otherwise renders a hidden English instructions block describing
       * a keyboard drag this board does not implement. The app defaults to
       * Indonesian, so that text would be both untranslated and untrue.
       */
      accessibility={{ screenReaderInstructions: { draggable: "" } }}
    >
      {columns}
      <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
        {draggedRow ? <ProjectCard row={draggedRow} canUpdate={false} moving={false} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Matches how the rest of the app scopes motion rather than suppressing it globally. */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
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
  // The column id IS the status, so a drop resolves straight to the new value.
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !canUpdate });

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      aria-busy={query.isPending || query.isFetchingNextPage}
      className={`min-w-0 rounded-lg p-2 ring-1 transition-colors md:w-[17rem] ${
        isOver ? "bg-accent/60 ring-2 ring-ring" : "bg-muted/40 ring-foreground/10"
      }`}
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
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: row.id,
    data: { row },
    disabled: !canUpdate || movePending,
  });

  /*
   * `attributes` is deliberately not spread. It sets role="button" and
   * tabIndex={0} on the card, which would add a focus stop that does nothing
   * for keyboard users and would sit between the card's own link and its status
   * menu in the tab order. Omitting it leaves the accessibility tree as it was.
   */
  return (
    <ProjectCard
      row={row}
      canUpdate={canUpdate}
      moving={moving}
      movePending={movePending}
      onMove={onMove}
      innerRef={setNodeRef}
      handleProps={listeners}
      dragging={isDragging}
    />
  );
}

function ProjectCard({
  row,
  canUpdate,
  moving,
  movePending,
  onMove,
  innerRef,
  handleProps,
  dragging = false,
  overlay = false,
}: {
  row: ProjectRow;
  canUpdate: boolean;
  moving: boolean;
  movePending?: boolean;
  onMove?: (row: ProjectRow, status: ProjectStatus) => Promise<void>;
  innerRef?: (node: HTMLElement | null) => void;
  handleProps?: Record<string, unknown>;
  dragging?: boolean;
  overlay?: boolean;
}) {
  const t = useT();
  const { formatDate, percent } = useFormat();
  const statusLabel = useStatusLabel();
  const menuLabel = interpolate(t.projects.changeStatusLabel, { name: row.name });

  return (
    <Card
      size="sm"
      ref={innerRef}
      {...handleProps}
      className={[
        handleProps && !movePending ? "cursor-grab active:cursor-grabbing" : "",
        dragging ? "opacity-40" : "",
        overlay ? "cursor-grabbing shadow-lg ring-2 ring-ring" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <CardHeader>
        <CardTitle as="h3" className="min-w-0">
          {/*
            draggable={false}: an <a> is natively draggable, so without this the
            browser starts its own link drag with its own ghost image alongside
            dnd-kit's overlay.
          */}
          <Link
            id={overlay ? undefined : `project-board-link-${row.id}`}
            href={`/projects/${row.id}`}
            draggable={false}
            className="block truncate hover:underline"
          >
            {row.name}
          </Link>
        </CardTitle>
        <p className="truncate font-mono text-muted-foreground">{row.code}</p>
        {canUpdate && onMove && (
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
                    // Keeps a press on the menu from arming the card's drag sensor.
                    onPointerDown={(event) => event.stopPropagation()}
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
