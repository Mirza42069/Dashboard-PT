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
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select the password and copy it manually");
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {result?.isNewAccount ? "Account created" : "Password reset"}
          </DialogTitle>
          <DialogDescription>
            Give this temporary password to {result?.email}. They will be asked to choose their own
            the first time they sign in.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 bg-muted p-2">
          <code className="flex-1 font-mono text-sm break-all select-all">{result?.password}</code>
          <Button variant="outline" size="icon-sm" onClick={copy} aria-label="Copy password">
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>

        <p className="text-xs text-destructive">
          This is shown once and is not stored. If you lose it, reset the password again.
        </p>

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
