import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import type { Metadata } from "next";

import ChangePasswordForm from "@/components/change-password-form";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Change password · DashboardV2",
};

export default async function ChangePasswordPage() {
  // skipPasswordChangeRedirect, or this page would redirect to itself forever.
  const session = await requireSession({ skipPasswordChangeRedirect: true });
  const forced = session.user.mustChangePassword;

  return (
    <div className="grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{forced ? "Set your password" : "Change password"}</CardTitle>
            <CardDescription>
              {forced
                ? "You're signed in with a temporary password issued by an administrator. Choose your own to continue."
                : `Signed in as ${session.user.email}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Signing in elsewhere will be revoked once your password changes.
        </p>
      </div>
    </div>
  );
}
