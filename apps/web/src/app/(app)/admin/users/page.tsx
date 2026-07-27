import type { Metadata } from "next";

import { requireAdmin } from "@/lib/session";

import UsersTable from "./users-table";

export const metadata: Metadata = {
  title: "Users · DashboardV2",
};

export default async function AdminUsersPage() {
  const session = await requireAdmin();

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Users</h1>
        <p className="text-xs text-muted-foreground">
          Sign-up is closed — every account is created here. New users receive a temporary password
          and must set their own on first sign-in.
        </p>
      </div>

      <UsersTable currentUserId={session.user.id} />
    </div>
  );
}
