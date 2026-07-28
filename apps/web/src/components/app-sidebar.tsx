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
        "hidden shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-out md:flex",
        collapsed ? "w-14" : "w-56",
      )}
    >
      {/*
       * The mark already reads "V2" — a wordmark beside it would just say it twice.
       *
       * px-4 unconditionally, and deliberately so. The rail is w-14 (56px) and
       * the mark is size-6 (24px), so 16px of padding leaves it in exactly the
       * place centring would: (56 - 24) / 2 = 16. Switching to justify-center
       * when collapsed looks equivalent but is not, because `width` animates
       * over 200ms while the class swap is instant — the mark would jump to the
       * middle of the still-224px sidebar and slide back. Anchoring to a fixed
       * padding makes its position independent of the animating width.
       */}
      <div className="flex h-12 shrink-0 items-center border-b px-4">
        <BrandMark />
      </div>
      {/* Padding transitions on the same curve as the rail; snapping it would
          shift every nav row sideways on the first frame of the slide. */}
      <div
        className={cn(
          "flex-1 overflow-y-auto py-3 transition-[padding] duration-200 ease-out",
          collapsed ? "px-2" : "px-3",
        )}
      >
        <AppNav isAdmin={isAdmin} collapsed={collapsed} />
      </div>
    </aside>
  );
}
