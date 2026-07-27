import { ModeToggle } from "./mode-toggle";
import MobileNav from "./mobile-nav";
import UserMenu from "./user-menu";

export default function Header({ isAdmin }: { isAdmin: boolean }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-card px-3 md:px-4">
      <div className="flex items-center gap-2">
        <MobileNav isAdmin={isAdmin} />
        <span className="text-sm font-semibold tracking-tight md:hidden">DashboardV2</span>
      </div>
      <div className="flex items-center gap-1.5">
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
