"use client";

import { Dialog, DialogContent } from "@DashboardV2/ui/components/dialog";
import { Sheet, SheetContent } from "@DashboardV2/ui/components/sheet";
import { cn } from "@DashboardV2/ui/lib/utils";

/**
 * The container an edit form sits in: a right-hand slide-over when editing an
 * existing record, a centred dialog when creating a new one.
 *
 * Editing slides in beside the row it belongs to, so the row stays visible and
 * the panel reads as an extension of it. Creating has no row to sit next to, so
 * it stays centred. Every form in the app follows that same rule — this lived
 * inside project-form-dialog until the companies form needed the identical
 * behaviour, at which point one copy was better than two that could drift.
 *
 * Both shells are the same `@base-ui/react/dialog` primitive underneath —
 * sheet.tsx imports it as `SheetPrimitive` — which is why a form inside can
 * keep using DialogHeader/DialogTitle/DialogDescription in either and stay
 * correctly labelled.
 */
export default function FormShell({
  asSheet,
  open,
  onOpenChange,
  closeLabel,
  className,
  children,
}: {
  asSheet: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closeLabel: string;
  /** Width class for both shells, e.g. "sm:max-w-lg" for a two-column form. */
  className?: string;
  children: React.ReactNode;
}) {
  if (asSheet) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* p-0 because the form owns its own padding — the header, the
            scrolling body and the footer each need different insets. */}
        <SheetContent side="right" closeLabel={closeLabel} className={cn("w-full p-0", className)}>
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className} closeLabel={closeLabel}>
        {children}
      </DialogContent>
    </Dialog>
  );
}
