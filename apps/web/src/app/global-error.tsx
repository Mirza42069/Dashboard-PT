"use client";

import "../index.css";
import { Button } from "@DashboardV2/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@DashboardV2/ui/components/empty";
import { RotateCcw, TriangleAlert } from "@DashboardV2/ui/components/icons";
import { useEffect } from "react";

import { DEFAULT_LOCALE, getDictionary, interpolate } from "@/i18n";

/**
 * The last line of defence: shown when the root layout itself throws, which is
 * why it has to bring its own <html> and <body> — the layout that normally
 * provides them is exactly what failed.
 *
 * Two consequences of that, both deliberate:
 *
 *   - The stylesheet is imported here directly. It normally arrives via
 *     layout.tsx, which is not rendering.
 *   - Locale and theme both come from cookies read server-side in the layout, so
 *     neither is available. This falls back to the default locale and light
 *     mode rather than growing an effect that reads document.cookie — a file
 *     that only runs when everything else is broken should have nothing in it
 *     that can itself break.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = getDictionary(DEFAULT_LOCALE);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang={DEFAULT_LOCALE}>
      <body className="antialiased">
        <div className="grid min-h-svh place-items-center bg-background p-6 text-foreground">
          <Empty className="max-w-md border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TriangleAlert />
              </EmptyMedia>
              <EmptyTitle as="h1">{t.common.somethingWentWrong}</EmptyTitle>
              <EmptyDescription>{t.common.errorDescription}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={reset}>
                <RotateCcw />
                {t.common.retry}
              </Button>
              {error.digest && (
                <p className="font-mono text-xs text-muted-foreground">
                  {interpolate(t.common.errorReference, { digest: error.digest })}
                </p>
              )}
            </EmptyContent>
          </Empty>
        </div>
      </body>
    </html>
  );
}
