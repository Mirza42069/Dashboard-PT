"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@DashboardV2/ui/components/empty";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";

/**
 * Catches render and data errors anywhere below app/ — the (app) chrome and the
 * bare auth pages alike — so a thrown query reads as a card with a way out
 * instead of Next's unstyled error screen.
 *
 * This renders inside the root layout, so Providers is still mounted and the
 * dictionary is available. global-error.tsx covers the other case, where the
 * root layout is itself what failed.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    // Production replaces the message and stack with a digest before this
    // component ever sees the error, so log the object for whoever has a console
    // open — in dev that is the real stack.
    console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-svh place-items-center p-6">
      <Empty className="max-w-md border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert />
          </EmptyMedia>
          <EmptyTitle>{t.common.somethingWentWrong}</EmptyTitle>
          <EmptyDescription>{t.common.errorDescription}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {/* reset() re-renders the segment that threw rather than reloading the
              page, so a transient failure recovers without losing the session. */}
          <Button onClick={reset}>
            <RotateCcw />
            {t.common.retry}
          </Button>
          {/* The digest is the only thread from a user's screenshot back to the
              server log, so it is worth showing even though it means nothing to
              them. Absent in dev, where the console has the real thing. */}
          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground">
              {interpolate(t.common.errorReference, { digest: error.digest })}
            </p>
          )}
        </EmptyContent>
      </Empty>
    </div>
  );
}
