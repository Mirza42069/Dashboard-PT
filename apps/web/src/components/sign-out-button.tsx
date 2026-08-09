"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { LogOut } from "@DashboardV2/ui/components/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { useT } from "@/i18n/provider";
import { authClient } from "@/lib/auth-client";

/**
 * Reused by /change-password's forced state — the one place in the app that
 * has no AppShell (and so no UserMenu) to sign out from, which is exactly
 * where a user who lost their temporary password gets stuck otherwise.
 */
export default function SignOutButton({ className }: { className?: string }) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={() => {
        authClient.signOut({
          fetchOptions: {
            onSuccess: () => {
              queryClient.clear();
              router.push("/login");
              router.refresh();
            },
          },
        });
      }}
    >
      <LogOut />
      {t.auth.signOut}
    </Button>
  );
}
