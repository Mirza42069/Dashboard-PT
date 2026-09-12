"use client";

import { useId, useState } from "react";
import { Button } from "@DashboardV2/ui/components/button";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import { useT } from "@/i18n/provider";
import { interpolate } from "@/i18n";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@DashboardV2/ui/components/dialog";

export type TemporaryPasswordResult = {
  name: string;
  email: string;
  temporaryPassword: string;
  /** False when the invite email could not be delivered — the password needs
      manual delivery. Absent for admin resets, which never email. */
  inviteSent?: boolean;
};

export default function TempPasswordDialog({ result, onDismiss }: {
  result: TemporaryPasswordResult;
  onDismiss: () => void;
}) {
  const t = useT();
  const id = useId();
  const [status, setStatus] = useState("");

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <DialogContent closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{interpolate(t.users.tempPasswordTitle, { name: result.name })}</DialogTitle>
          <DialogDescription id={`${id}-hint`}>{t.users.tempPasswordHint}</DialogDescription>
        </DialogHeader>
        <p className="break-words text-sm">{result.email}</p>
        <div className="space-y-2">
          <Label htmlFor={id}>{t.users.tempPasswordLabel}</Label>
          <Input
            id={id}
            value={result.temporaryPassword}
            readOnly
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-base"
            aria-describedby={`${id}-hint`}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={async () => {
            try {
              await navigator.clipboard.writeText(result.temporaryPassword);
              setStatus(t.users.tempPasswordCopied);
            } catch {
              setStatus(t.users.tempPasswordCopyFailed);
            }
          }}>{t.users.copyTempPassword}</Button>
          <Button type="button" variant="outline" onClick={onDismiss}>{t.common.close}</Button>
        </div>
        {result.inviteSent === false && (
          <p role="alert" className="text-sm text-destructive">{t.users.inviteEmailFailed}</p>
        )}
        <p role="status" className="text-sm text-muted-foreground">{status}</p>
      </DialogContent>
    </Dialog>
  );
}
