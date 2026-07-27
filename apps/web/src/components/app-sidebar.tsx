import AppNav from "./app-nav";

export default function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-12 items-center gap-2 border-b px-4">
        <span className="flex size-6 items-center justify-center bg-primary text-[0.625rem] font-semibold text-primary-foreground">
          D2
        </span>
        <span className="text-sm font-semibold tracking-tight">DashboardV2</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <AppNav isAdmin={isAdmin} />
      </div>
    </aside>
  );
}
