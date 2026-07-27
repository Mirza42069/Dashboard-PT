import { cn } from "@DashboardV2/ui/lib/utils";

import AppNav from "./app-nav";
import { BrandMark } from "./brand";

export default function AppSidebar({
  isAdmin,
  collapsed,
}: {
  isAdmin: boolean;
  collapsed: boolean;
}) {
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r bg-card transition-[width] duration-200 md:flex",
        collapsed ? "w-14" : "w-56",
      )}
    >
      {/* The mark already reads "V2" — a wordmark beside it would just say it twice. */}
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b",
          collapsed ? "justify-center px-0" : "px-4",
        )}
      >
        <BrandMark />
      </div>
      <div className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
        <AppNav isAdmin={isAdmin} collapsed={collapsed} />
      </div>
    </aside>
  );
}
