import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import ChangePasswordForm from "@/components/change-password-form";
import { getDictionary, getLocale, interpolate } from "@/i18n";
import { requireSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.password.changeTitle} · ${BRAND_NAME}` };
}

export default async function ChangePasswordPage() {
  // skipPasswordChangeRedirect, or this page would redirect to itself forever.
  const session = await requireSession({ skipPasswordChangeRedirect: true });
  const dict = getDictionary(await getLocale());
  const forced = session.user.mustChangePassword;

  return (
    <div className="grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <Card>
          <CardHeader>
            {/* This page renders bare — no app chrome, no page header — so the
                card title is the document's only heading and takes the h1. */}
            <CardTitle as="h1">
              {forced ? dict.password.setTitle : dict.password.changeTitle}
            </CardTitle>
            <CardDescription>
              {forced
                ? dict.password.forcedDescription
                : interpolate(dict.password.signedInAs, { email: session.user.email })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">{dict.password.revokeNote}</p>
      </div>
    </div>
  );
}
