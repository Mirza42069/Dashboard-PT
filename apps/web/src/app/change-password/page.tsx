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
import SignOutButton from "@/components/sign-out-button";
import { getDictionary, getLocale, interpolate } from "@/i18n";
import { requireSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.password.changeTitle} - ${BRAND_NAME}` };
}

export default async function ChangePasswordPage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());

  return (
    <div className="grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <Card>
          <CardHeader>
            {/* This page renders bare — no app chrome, no page header — so the
                card title is the document's only heading and takes the h1. */}
            <CardTitle as="h1">
              {dict.password.changeTitle}
            </CardTitle>
            <CardDescription>
              {interpolate(dict.password.signedInAs, { email: session.user.email })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">{dict.password.revokeNote}</p>

        {/* This page has no AppShell, so it's the one place in the app with
            no sign-out control at all — without this, an account that lost
            its issued credential has no way out of /login -> /dashboard ->
            /change-password. */}
        <SignOutButton className="w-full" />
      </div>
    </div>
  );
}
