import { Card, CardContent } from "@DashboardV2/ui/components/card";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { BRAND_NAME, BrandMark } from "@/components/brand";
import Loader from "@/components/loader";
import SignInForm from "@/components/sign-in-form";
import { getDictionary, getLocale } from "@/i18n";
import { getSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.auth.signIn} - ${BRAND_NAME}` };
}

export default async function LoginPage() {
  // Resolved against the API, not inferred from the cookie: a stale cookie must
  // fall through to the form so the user can sign in again, rather than being
  // volleyed to /dashboard and straight back here.
  const session = await getSession();
  if (session?.user) {
    redirect("/dashboard");
  }

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
            {/* useSearchParams needs a suspense boundary during prerender. */}
            <Suspense fallback={<Loader />}>
              <SignInForm />
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
