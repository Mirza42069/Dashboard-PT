"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@DashboardV2/ui/components/dialog";
import { AiFile, Pencil } from "@DashboardV2/ui/components/icons";

import { useT } from "@/i18n/provider";

export default function ProjectCreateSourceDialog({
  open,
  onOpenChange,
  onManual,
  onExcel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onManual: () => void;
  onExcel: () => void;
}) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{t.projectImport.chooseTitle}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            variant="outline"
            className="h-auto items-start justify-start gap-3 p-4 text-left whitespace-normal"
            onClick={onManual}
          >
            <Pencil className="mt-0.5 size-5 shrink-0" />
            <span>
              <strong className="block text-sm">{t.projectImport.manualTitle}</strong>
              <span className="mt-1 block font-normal text-muted-foreground">
                {t.projectImport.manualDescription}
              </span>
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto items-start justify-start gap-3 p-4 text-left whitespace-normal"
            onClick={onExcel}
          >
            <AiFile className="mt-0.5 size-5 shrink-0" />
            <span>
              <strong className="block text-sm">{t.projectImport.excelTitle}</strong>
              <span className="mt-1 block font-normal text-muted-foreground">
                {t.projectImport.excelDescription}
              </span>
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
