import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Lock } from "@DashboardV2/ui/components/icons";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BRAND_NAME, CONTACT_EMAIL } from "@/components/brand";
import SignOutButton from "@/components/sign-out-button";
import { getDictionary, getLocale } from "@/i18n";
import { trialHasEnded } from "@DashboardV2/api/lib/trial";

import { requireSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.trial.endedTitle} - ${BRAND_NAME}` };
}

/**
 * Where a session that outlived its trial lands.
 *
 * Sign-in is refused for these accounts in packages/auth, but that hook runs
 * only when a session is created — this page catches the one already open.
 * Built as a sibling of /change-password and for the same reason: it sits
 * outside the (app) group so it renders with no shell, which means it has to
 * carry its own way out.
 */
export default async function TrialEndedPage() {
  // skipTrialEndedRedirect, or this page would redirect to itself forever.
  const session = await requireSession({ skipTrialEndedRedirect: true });

  // Reachable by URL. An account whose trial was extended while it sat here
  // should not be told it is over.
  if (!trialHasEnded(session.user)) {
    redirect("/dashboard");
  }

  const dict = getDictionary(await getLocale());

  return (
    <div className="grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <Card>
          <CardHeader>
            <div
              className="mb-2 grid size-10 place-items-center rounded-md bg-muted text-muted-foreground"
              aria-hidden
            >
              <Lock className="size-5" />
            </div>
            {/* Bare page — this is the document's only heading. */}
            <CardTitle as="h1">{dict.trial.endedTitle}</CardTitle>
            <CardDescription>{dict.trial.endedDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{session.user.email}</p>
            {/* The in-app contact form runs through protectedProcedure, which
                refuses this account by design — so the only way to reach a
                human from this page is one that needs no session at all. */}
            <p className="text-sm text-muted-foreground">
              {dict.trial.contactHint}{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`${BRAND_NAME} trial`)}`}
                className="font-medium text-foreground underline underline-offset-4"
              >
                {dict.trial.contactCta}
              </a>
            </p>
          </CardContent>
        </Card>

        <SignOutButton className="w-full" />
      </div>
    </div>
  );
}
