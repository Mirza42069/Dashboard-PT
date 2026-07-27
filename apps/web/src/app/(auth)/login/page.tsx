import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@DashboardV2/ui/components/card";
import type { Metadata } from "next";
import { Suspense } from "react";

import Loader from "@/components/loader";
import { ModeToggle } from "@/components/mode-toggle";
import SignInForm from "@/components/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in · DashboardV2",
};

export default function LoginPage() {
  return (
    <div className="grid min-h-svh place-items-center px-4 py-10">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>

      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex size-10 items-center justify-center bg-primary text-sm font-semibold text-primary-foreground">
            D2
          </div>
          <h1 className="text-lg font-semibold tracking-tight">DashboardV2</h1>
          <p className="text-xs text-muted-foreground">Internal company dashboard</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use the credentials issued to you.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* useSearchParams needs a suspense boundary during prerender. */}
            <Suspense fallback={<Loader />}>
              <SignInForm />
            </Suspense>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Accounts are created by an administrator. Contact yours if you need access or a password
          reset.
        </p>
      </div>
    </div>
  );
}
