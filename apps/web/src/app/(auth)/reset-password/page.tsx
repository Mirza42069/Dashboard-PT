import type { Metadata } from "next";
import { Suspense } from "react";

import { BRAND_NAME } from "@/components/brand";
import ResetPasswordForm from "@/components/reset-password-form";
import { getDictionary, getLocale } from "@/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.password.resetTitle} - ${BRAND_NAME}` };
}

export default function ResetPasswordPage() {
  return (
    // Renders bare like /login and /change-password — no app chrome to flash
    // for someone who cannot sign in yet. The root layout already marks this
    // noindex; a URL carrying a live token must never be indexed.
    <div className="grid min-h-svh place-items-center px-4 py-10">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
