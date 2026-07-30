"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { cn } from "@DashboardV2/ui/lib/utils";
import { RefreshCw, TriangleAlert } from "@DashboardV2/ui/components/icons";

import { useT } from "@/i18n/provider";

/**
 * Inline failure state for a query.
 *
 * The QueryCache's global onError already raises a toast, but a toast is
 * transient and easily missed — and the surfaces that render `null` on failure
 * leave the user staring at an empty page with no explanation and nothing to
 * click. This is the recoverable half: it says what broke and offers a retry.
 */
export function QueryError({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry: () => void;
  className?: string;
}) {
  const t = useT();

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      <TriangleAlert className="size-5 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium">{t.common.loadFailed}</p>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : t.common.somethingWentWrong}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw />
        {t.common.retry}
      </Button>
    </div>
  );
}
