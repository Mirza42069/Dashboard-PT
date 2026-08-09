import AppShell from "@/components/app-shell";
import { requireSession } from "@/lib/session";
import { getSidebarCollapsed } from "@/lib/sidebar";
import { getTextScale } from "@/lib/text-scale";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Authoritative gate for every page in this group. proxy.ts only checks that
  // a session cookie exists; this verifies it actually resolves.
  const session = await requireSession();
  const [collapsed, textScale] = await Promise.all([getSidebarCollapsed(), getTextScale()]);

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
      initialTextScale={textScale}
    >
      {children}
    </AppShell>
  );
}
