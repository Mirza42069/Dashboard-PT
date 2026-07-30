"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Checkbox } from "@DashboardV2/ui/components/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@DashboardV2/ui/components/empty";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "@DashboardV2/ui/components/icons";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";

import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

/**
 * Assigns which company Users (role=user) can see and act on this project.
 * Admins and super admins already see every project in scope, so they never
 * appear in the picker — this list is exactly the accounts membership would
 * change anything for.
 */
export default function TeamTab({ projectId }: { projectId: string }) {
  const t = useT();
  const queryClient = useQueryClient();

  const membersQuery = useQuery(trpc.project.listMembers.queryOptions({ projectId }));
  const optionsQuery = useQuery(trpc.project.memberOptions.queryOptions());
  const setMembers = useMutation(trpc.project.setMembers.mutationOptions());

  // Local, editable copy of the assignment — null until the current members
  // have loaded once, so a slow request never flashes an "everyone unchecked"
  // state before snapping to the real selection.
  const [selected, setSelected] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (membersQuery.data && selected === null) {
      setSelected(new Set(membersQuery.data.map((member) => member.id)));
    }
  }, [membersQuery.data, selected]);

  if (membersQuery.isPending || optionsQuery.isPending || selected === null) {
    return <Skeleton className="h-48 w-full" />;
  }

  const options = optionsQuery.data ?? [];

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  async function save() {
    if (!selected) return;
    try {
      await setMembers.mutateAsync({ projectId, userIds: [...selected] });
      await queryClient.invalidateQueries(trpc.project.pathFilter());
      toast.success(t.projects.membersSavedToast);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.projects.teamTab}</CardTitle>
        <CardDescription>{t.projects.addMembers}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {options.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t.projects.noMembers}</EmptyTitle>
              <EmptyDescription>{t.projects.addMembers}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-1">
            {options.map((user) => (
              <label
                key={user.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
              >
                <Checkbox
                  checked={selected.has(user.id)}
                  onCheckedChange={() => toggle(user.id)}
                  aria-label={user.name}
                />
                <span className="font-medium">{user.name}</span>
                <span className="text-muted-foreground">{user.email}</span>
              </label>
            ))}
          </div>
        )}
        <Button size="sm" disabled={setMembers.isPending} onClick={() => void save()}>
          <Save />
          {t.common.save}
        </Button>
      </CardContent>
    </Card>
  );
}
