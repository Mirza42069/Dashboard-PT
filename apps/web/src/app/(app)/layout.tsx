import AppShell from "@/components/app-shell";
import { getCompanyScope, requireSession } from "@/lib/session";
import { getSidebarCollapsed } from "@/lib/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Authoritative gate for every page in this group. proxy.ts only checks that
  // a session cookie exists; this verifies it actually resolves.
  const session = await requireSession();
  const [collapsed, scope] = await Promise.all([getSidebarCollapsed(), getCompanyScope()]);

  return (
    <AppShell
      // Passed down rather than re-fetched with useSession() in the browser.
      // That hook is always pending during SSR, so the chrome rendered a
      // skeleton on the server and the real menu on the client — a hydration
      // mismatch that made React discard the server HTML and refetch every
      // query on load.
      user={{
        name: session.user.name,
        email: session.user.email,
        role: session.user.role ?? "user",
      }}
      initialCollapsed={collapsed}
      vertical={scope.vertical}
    >
      {children}
    </AppShell>
  );
}
