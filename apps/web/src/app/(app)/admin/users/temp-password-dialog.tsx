"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@DashboardV2/ui/components/dialog";
import { Check, Copy } from "@DashboardV2/ui/components/icons";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";

export type TempPasswordResult = {
  email: string;
  password: string;
  /** Distinguishes a fresh account from a reset of an existing one. */
  isNewAccount: boolean;
};

export default function TempPasswordDialog({
  result,
  onClose,
}: {
  result: TempPasswordResult | null;
  onClose: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t.users.copyFailed);
    }
  }

  return (
    <Dialog
      open={result !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>
            {result?.isNewAccount ? t.users.tempTitleNew : t.users.tempTitleReset}
          </DialogTitle>
          <DialogDescription>
            {interpolate(t.users.tempDescription, { email: result?.email ?? "" })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md bg-muted p-2">
          <code className="flex-1 font-mono text-sm break-all select-all">{result?.password}</code>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={copy}
            aria-label={t.users.copyPassword}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>

        <p className="text-xs text-destructive">{t.users.tempShownOnce}</p>

        <DialogFooter>
          <Button onClick={onClose}>{t.users.done}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
