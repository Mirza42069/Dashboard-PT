import AppSidebar from "@/components/app-sidebar";
import Header from "@/components/header";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Authoritative gate for every page in this group. middleware.ts only checks
  // that a session cookie exists; this verifies it actually resolves.
  const session = await requireSession();
  const isAdmin = session.user.role === "admin";

  return (
    <div className="flex h-svh">
      <AppSidebar isAdmin={isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header isAdmin={isAdmin} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
