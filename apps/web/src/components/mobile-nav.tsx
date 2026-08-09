"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@DashboardV2/ui/components/sheet";
import type { Role } from "@DashboardV2/api/lib/permissions";
import { Menu } from "@DashboardV2/ui/components/icons";
import { useState } from "react";

import { useT } from "@/i18n/provider";

import AppNav from "./app-nav";
import { BRAND_NAME } from "./brand";
import SupportNavItem from "./support-nav-item";

export default function MobileNav({
  role,
  onContactSupport,
}: {
  role: Role;
  onContactSupport: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon-sm" className="md:hidden" />}
        aria-label={t.nav.openNavigation}
      >
        <Menu />
      </SheetTrigger>
      <SheetContent side="left" className="w-64" closeLabel={t.common.close}>
        <SheetHeader>
          <SheetTitle>{BRAND_NAME}</SheetTitle>
          <SheetDescription>{t.auth.tagline}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-4">
          <AppNav role={role} onNavigate={() => setOpen(false)} />
          <div className="mt-auto border-t pt-3">
            <SupportNavItem
              role={role}
              onNavigate={() => setOpen(false)}
              onContactSupport={() => {
                setOpen(false);
                requestAnimationFrame(onContactSupport);
              }}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
