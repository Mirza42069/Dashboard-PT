import { Card, CardContent } from "@DashboardV2/ui/components/card";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { BRAND_NAME, BrandMark } from "@/components/brand";
import SignInForm from "@/components/sign-in-form";
import { getDictionary, getLocale } from "@/i18n";
import { getSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.auth.signIn} - ${BRAND_NAME}` };
}

export default async function LoginPage() {
  const dict = getDictionary(await getLocale());

  return (
    <div className="grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        {/* The mark carries the brand without a separate Latin wordmark. */}
        <div className="space-y-1 text-center">
          <BrandMark size="lg" className="mx-auto mb-3" />
          <p className="text-xs text-muted-foreground">{dict.auth.tagline}</p>
        </div>

        <Card>
          <CardContent>
            <Suspense fallback={
              <div aria-busy="true" className="space-y-4">
                <div className="space-y-1">
                  <h1 className="text-sm font-medium">{dict.auth.signIn}</h1>
                  <p className="text-xs text-muted-foreground">{dict.auth.useIssuedCredentials}</p>
                </div>
                <div aria-hidden="true" className="space-y-4">
                  {[0, 1].map((field) => (
                    <div key={field} className="space-y-2">
                      <Skeleton className="h-4 w-28 motion-reduce:animate-none" />
                      <Skeleton className="h-9 w-full motion-reduce:animate-none" />
                    </div>
                  ))}
                  <Skeleton className="h-10 w-full motion-reduce:animate-none" />
                </div>
              </div>
            }>
              <SessionCheckedForm />
            </Suspense>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          {dict.auth.contactAdminFootnote}
        </p>
      </div>
    </div>
  );
}

async function SessionCheckedForm() {
  // Verify stale cookies without blocking the public login frame from streaming.
  const session = await getSession();
  if (session?.user) {
    redirect("/dashboard");
  }
  return <SignInForm />;
}
