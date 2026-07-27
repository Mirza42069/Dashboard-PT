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
import { Menu } from "lucide-react";
import { useState } from "react";

import AppNav from "./app-nav";

export default function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon-sm" className="md:hidden" />}
        aria-label="Open navigation"
      >
        <Menu />
      </SheetTrigger>
      <SheetContent side="left" className="w-64">
        <SheetHeader>
          <SheetTitle>DashboardV2</SheetTitle>
          <SheetDescription>Internal company dashboard</SheetDescription>
        </SheetHeader>
        <div className="px-3 pb-4">
          <AppNav isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
