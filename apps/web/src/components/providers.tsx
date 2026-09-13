"use client";

import { Toaster } from "@DashboardV2/ui/components/sonner";
import { TooltipProvider } from "@DashboardV2/ui/components/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import type { Locale } from "@/i18n";
import { I18nProvider } from "@/i18n/provider";
import { getQueryClient } from "@/utils/trpc";

export default function Providers({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const queryClient = getQueryClient();

  return (
    <I18nProvider locale={locale}>
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          {children}
          <ReactQueryDevtools />
        </QueryClientProvider>
        <Toaster richColors theme="light" />
      </TooltipProvider>
    </I18nProvider>
  );
}
