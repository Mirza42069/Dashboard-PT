import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import type { Metadata } from "next";
import Link from "next/link";

import { BRAND_NAME, BrandMark } from "@/components/brand";
import SetPasswordForm from "@/components/set-password-form";
import { getDictionary, getLocale } from "@/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.password.setTitle} - ${BRAND_NAME}` };
}

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const dict = getDictionary(await getLocale());
  const validToken = !error && typeof token === "string" && token.length > 0;

  return (
    <div className="grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <BrandMark size="lg" className="mx-auto" />
        <Card>
          <CardHeader>
            <CardTitle as="h1">
              {validToken ? dict.password.setTitle : dict.password.invalidSetupTitle}
            </CardTitle>
            <CardDescription>
              {validToken
                ? dict.password.setupDescription
                : dict.password.invalidSetupDescription}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {validToken ? (
              <SetPasswordForm token={token} />
            ) : (
              <Button render={<Link href="/login" />} className="w-full" size="lg">
                {dict.auth.signIn}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
