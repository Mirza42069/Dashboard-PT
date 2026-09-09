import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { BRAND_NAME, BrandMark } from "@/components/brand";
import LanguageSwitcher from "@/components/language-switcher";
import SignInForm from "@/components/sign-in-form";
import { getDictionary, getLocale } from "@/i18n";
import { getSession } from "@/lib/session";
import { SITE_URL } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const { auth } = getDictionary(locale);
  const title = `${BRAND_NAME} | ${auth.tagline}`;
  const description = auth.landingBody;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/` },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: BRAND_NAME,
      url: `${SITE_URL}/`,
      title,
      description,
      locale: locale === "id" ? "id_ID" : "en_US",
      images: [{ url: `${SITE_URL}/opengraph-image`, width: 1200, height: 630, alt: "Fushin - Construction progress reporting" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${SITE_URL}/opengraph-image`],
    },
  };
}

export default async function LoginPage() {
  const { auth } = getDictionary(await getLocale());

  return (
    <div className="min-h-svh bg-background text-foreground lg:flex lg:h-svh lg:flex-col [@media(min-width:64rem)_and_(min-height:48.001rem)]:overflow-hidden">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-5 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="text-xl font-semibold tracking-tight">{BRAND_NAME}</span>
        </div>
        <LanguageSwitcher />
      </header>

      <main className="grid lg:min-h-0 lg:flex-1 lg:grid-cols-2 [@media(min-width:64rem)_and_(max-height:48rem)]:min-h-fit">
        <section aria-label={auth.signIn} className="min-w-0 border-b border-border px-6 py-14 sm:px-12 lg:flex lg:flex-col lg:justify-center lg:border-e lg:border-b-0 lg:px-10 lg:py-6 xl:px-16">
          <div className="mx-auto w-full max-w-md">
            <p className="mb-3 text-xs text-muted-foreground">{auth.workspaceLabel}</p>
            <h1 className="max-w-md text-3xl leading-tight font-semibold tracking-tight xl:text-4xl">{auth.landingTitle}</h1>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">{auth.landingBody}</p>
            <div className="mt-6 rounded-lg border border-border bg-card p-5 shadow-sm [&_input]:h-11 [&_input]:text-base [&_button[type=submit]]:h-11">
              <Suspense fallback={
                <div aria-busy="true" aria-label={auth.signIn} className="space-y-5">
                  <h2 className="text-lg font-medium">{auth.signIn}</h2>
                  <div aria-hidden="true" className="space-y-5">
                    {[0, 1, 2].map((field) => <Skeleton key={field} className="h-11 w-full motion-reduce:animate-none" />)}
                  </div>
                </div>
              }>
                <SessionCheckedForm />
              </Suspense>
            </div>
            <p className="mt-6 text-xs leading-6 text-muted-foreground">{auth.contactAdminFootnote}</p>
          </div>
        </section>

        <section aria-label={auth.overviewLabel} tabIndex={0} className="min-w-0 bg-card px-6 py-14 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-12 lg:overflow-y-auto lg:overscroll-contain lg:px-10 lg:py-20 xl:px-16 [@media(min-width:64rem)_and_(max-height:48rem)]:overflow-visible">
          <div className="mx-auto max-w-2xl space-y-16">
            <article>
              <p className="mb-4 text-xs text-muted-foreground">01 / {auth.baselineLabel}</p>
              <h2 className="text-2xl leading-tight font-medium tracking-tight">{auth.baselineTitle}</h2>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">{auth.baselineBody}</p>
              <ol className="mt-7 grid rounded-lg border border-border bg-background sm:grid-cols-3">
                {[auth.sourceLabel, auth.baselineLabel, auth.reviewLabel].map((label, index) => (
                  <li key={label} className="flex items-center gap-3 border-border p-5 not-last:border-b sm:block sm:not-last:border-e sm:not-last:border-b-0">
                    <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                    <p className="text-sm font-medium sm:mt-4">{label}</p>
                  </li>
                ))}
              </ol>
            </article>

            <article>
              <p className="mb-4 text-xs text-muted-foreground">02 / {auth.plannedLabel} & {auth.actualLabel}</p>
              <h2 className="text-2xl leading-tight font-medium tracking-tight">{auth.progressTitle}</h2>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">{auth.progressBody}</p>
              <figure className="mt-7 rounded-lg border border-border bg-background">
                <figcaption className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 text-xs">
                  <span className="font-mono">{auth.chartLabel}</span>
                  <span className="flex flex-wrap gap-4">
                    <span className="flex items-center gap-2"><span className="w-4 border-t-2 border-dashed border-current" />{auth.plannedLabel}</span>
                    <span className="flex items-center gap-2"><span className="w-4 border-t-2 border-chart-1" />{auth.actualLabel}</span>
                  </span>
                </figcaption>
                <div className="p-5">
                  <svg aria-hidden="true" viewBox="0 0 500 200" className="w-full" fill="none">
                    {[30, 75, 120, 165].map((y) => <path key={y} d={`M0 ${y}H500`} stroke="currentColor" opacity="0.1" />)}
                    <path d="M0 185C80 185 105 150 155 120S230 60 285 40S395 15 500 10" stroke="currentColor" strokeWidth="2" strokeDasharray="6 6" opacity="0.55" />
                    <path d="M0 185C75 185 105 167 155 142S235 95 285 78S340 47 375 43" stroke="var(--chart-1)" strokeWidth="3" />
                    <circle cx="375" cy="43" r="5" fill="var(--chart-1)" />
                  </svg>
                  <p className="mt-2 text-right font-mono text-xs text-muted-foreground">{auth.periodLabel}</p>
                </div>
              </figure>
            </article>

            <article className="border-t border-border pt-8">
              <p className="mb-4 text-xs text-muted-foreground">03 / {auth.reviewLabel}</p>
              <h2 className="text-2xl leading-tight font-medium tracking-tight">{auth.reviewTitle}</h2>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">{auth.reviewBody}</p>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}

async function SessionCheckedForm() {
  // Verify stale cookies without blocking the public login frame from streaming.
  const session = await getSession();
  if (session?.user) redirect("/dashboard");
  return <SignInForm />;
}
