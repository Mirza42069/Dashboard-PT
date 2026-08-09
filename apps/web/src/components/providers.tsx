"use client";

import { Toaster } from "@DashboardV2/ui/components/sonner";
import { TooltipProvider } from "@DashboardV2/ui/components/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import type { Locale } from "@/i18n";
import { I18nProvider } from "@/i18n/provider";
import type { Theme } from "@/lib/theme";
import { getQueryClient } from "@/utils/trpc";

export default function Providers({
  locale,
  theme,
  children,
}: {
  locale: Locale;
  theme: Theme;
  children: React.ReactNode;
}) {
  const queryClient = getQueryClient();

  return (
    // No ThemeProvider: the theme class is already on <html> from the server.
    // See lib/theme.ts for why next-themes was dropped.
    <I18nProvider locale={locale}>
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          {children}
          <ReactQueryDevtools />
        </QueryClientProvider>
        <Toaster richColors theme={theme} />
      </TooltipProvider>
    </I18nProvider>
  );
}
