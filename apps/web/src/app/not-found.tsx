import { Button } from "@DashboardV2/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@DashboardV2/ui/components/empty";
import { FileQuestionMark, House } from "lucide-react";
import Link from "next/link";

import { getDictionary, getLocale } from "@/i18n";

/**
 * Unmatched URLs and anything that calls notFound(). A server component, so it
 * reads the locale cookie directly rather than going through the provider.
 */
export default async function NotFound() {
  const t = getDictionary(await getLocale());

  return (
    <div className="grid min-h-svh place-items-center p-6">
      <Empty className="max-w-md border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestionMark />
          </EmptyMedia>
          <EmptyTitle>{t.common.notFoundTitle}</EmptyTitle>
          <EmptyDescription>{t.common.notFoundDescription}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {/* Straight to /dashboard rather than /, which only exists to redirect
              here anyway (app/page.tsx) — no reason to spend a round trip. */}
          <Button render={<Link href="/dashboard" />}>
            <House />
            {t.common.backToDashboard}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
