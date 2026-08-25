"use client";

import {
  PROJECT_MODULE_KEYS,
  normalizeHiddenProjectModules,
  type ProjectModuleKey,
} from "@DashboardV2/api/lib/project-modules";
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
import { Button } from "@DashboardV2/ui/components/button";
import { Checkbox } from "@DashboardV2/ui/components/checkbox";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@DashboardV2/ui/components/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import FormShell from "@/components/form-shell";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { trpc } from "@/utils/trpc";

export default function ProjectSectionsSheet({
  open,
  projectId,
  initialHiddenModules,
  onOpenChange,
}: {
  open: boolean;
  projectId: string;
  initialHiddenModules: readonly ProjectModuleKey[];
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [hiddenModules, setHiddenModules] = useState<ProjectModuleKey[]>(() =>
    normalizeHiddenProjectModules(initialHiddenModules),
  );
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const save = useMutation(trpc.project.setHiddenModules.mutationOptions());
  const initial = normalizeHiddenProjectModules(initialHiddenModules);
  const dirty = hiddenModules.join("|") !== initial.join("|");

  useEffect(() => {
    if (open) setHiddenModules(normalizeHiddenProjectModules(initialHiddenModules));
  }, [open, initialHiddenModules]);

  const modules: Array<{
    key: ProjectModuleKey;
    label: string;
    description: string;
  }> = [
    {
      key: "actions",
      label: t.projectSections.actions,
      description: t.projectSections.actionsDescription,
    },
    {
      key: "baseline",
      label: t.projectSections.baseline,
      description: t.projectSections.baselineDescription,
    },
    {
      key: "progress",
      label: t.projectSections.progress,
      description: t.projectSections.progressDescription,
    },
    {
      key: "notes",
      label: t.projectSections.notes,
      description: t.projectSections.notesDescription,
    },
  ];

  function requestClose() {
    if (dirty) setConfirmDiscard(true);
    else onOpenChange(false);
  }

  function setVisible(key: ProjectModuleKey, visible: boolean) {
    setHiddenModules((current) =>
      visible
        ? current.filter((value) => value !== key)
        : PROJECT_MODULE_KEYS.filter((value) => value === key || current.includes(value)),
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await save.mutateAsync({ projectId, hiddenModules });
      await Promise.all([
        queryClient.invalidateQueries(trpc.project.pathFilter()),
        queryClient.invalidateQueries(trpc.activity.pathFilter()),
      ]);
      toast.success(t.projectSections.saved);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.projectSections.saveFailed);
    }
  }

  return (
    <>
      <FormShell
        asSheet
        open={open}
        closeLabel={t.common.close}
        className="sm:max-w-md"
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else requestClose();
        }}
      >
        <form onSubmit={submit} className="flex h-full min-h-0 flex-col">
          <DialogHeader className="gap-1 p-4 pr-12">
            <DialogTitle>{t.projectSections.title}</DialogTitle>
            <DialogDescription>{t.projectSections.description}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              {t.projectSections.fixedSections}
            </p>
            {modules.map((module) => {
              const descriptionId = `project-section-${module.key}-description`;
              const visible = !hiddenModules.includes(module.key);
              return (
                <label
                  key={module.key}
                  htmlFor={`project-section-${module.key}`}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
                >
                  <Checkbox
                    id={`project-section-${module.key}`}
                    checked={visible}
                    aria-describedby={descriptionId}
                    onCheckedChange={(checked) => setVisible(module.key, Boolean(checked))}
                  />
                  <span className="min-w-0 space-y-1">
                    <span className="block text-sm font-medium">{module.label}</span>
                    <span id={descriptionId} className="block text-xs text-muted-foreground">
                      {module.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <DialogFooter className="border-t border-border bg-popover p-4">
            <Button type="button" variant="outline" onClick={requestClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </FormShell>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.projects.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.projects.discardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.keepEditing}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false);
                onOpenChange(false);
              }}
            >
              {t.common.discardChanges}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
