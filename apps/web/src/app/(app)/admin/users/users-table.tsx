"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@DashboardV2/ui/components/alert-dialog";
import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent } from "@DashboardV2/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@DashboardV2/ui/components/dropdown-menu";
import { Input } from "@DashboardV2/ui/components/input";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, MoreHorizontal, ShieldMinus, ShieldPlus, Trash2, UserX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";

import CreateUserDialog from "./create-user-dialog";
import TempPasswordDialog, { type TempPasswordResult } from "./temp-password-dialog";

const PAGE_SIZE = 25;

type PendingDelete = { id: string; name: string; email: string };

function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function UsersTable({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [tempPassword, setTempPassword] = useState<TempPasswordResult | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const usersQuery = useQuery(
    trpc.admin.listUsers.queryOptions({
      search,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
  );

  async function refresh() {
    await queryClient.invalidateQueries(trpc.admin.pathFilter());
  }

  const resetPassword = useMutation(trpc.admin.resetPassword.mutationOptions());
  const setRole = useMutation(trpc.admin.setRole.mutationOptions());
  const setBanned = useMutation(trpc.admin.setBanned.mutationOptions());
  const deleteUser = useMutation(trpc.admin.deleteUser.mutationOptions());

  /** Every mutation here is admin-only server-side; this is just error surfacing. */
  async function run(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action();
      await refresh();
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    }
  }

  const users = usersQuery.data?.users ?? [];
  const total = usersQuery.data?.total ?? 0;
  const hasNextPage = (page + 1) * PAGE_SIZE < total;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search by name or email"
          className="w-full sm:max-w-xs"
          aria-label="Search users"
        />
        <CreateUserDialog onCreated={setTempPassword} />
      </div>

      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.isPending &&
                Array.from({ length: 5 }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={6} className="pl-4">
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!usersQuery.isPending && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    {search ? `No users match "${search}"` : "No users yet"}
                  </TableCell>
                </TableRow>
              )}

              {users.map((user) => {
                const isSelf = user.id === currentUserId;
                const isAdmin = user.role === "admin";

                return (
                  <TableRow key={user.id}>
                    <TableCell className="pl-4 font-medium">
                      {user.name}
                      {isSelf && <span className="ml-1.5 text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={isAdmin ? "default" : "outline"} className="capitalize">
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.banned ? (
                        <Badge variant="destructive">Disabled</Badge>
                      ) : user.mustChangePassword ? (
                        <Badge variant="secondary">Pending first sign-in</Badge>
                      ) : (
                        <Badge variant="ghost">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" />}
                          aria-label={`Actions for ${user.name}`}
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52 bg-card">
                          <DropdownMenuItem
                            onClick={() =>
                              run(async () => {
                                const data = await resetPassword.mutateAsync({ userId: user.id });
                                setTempPassword({
                                  email: user.email,
                                  password: data.temporaryPassword,
                                  isNewAccount: false,
                                });
                              }, "Password reset")
                            }
                          >
                            <KeyRound />
                            Reset password
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={() =>
                              run(
                                () =>
                                  setRole.mutateAsync({
                                    userId: user.id,
                                    role: isAdmin ? "user" : "admin",
                                  }),
                                isAdmin ? "Demoted to user" : "Promoted to admin",
                              )
                            }
                          >
                            {isAdmin ? <ShieldMinus /> : <ShieldPlus />}
                            {isAdmin ? "Demote to user" : "Promote to admin"}
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            disabled={isSelf}
                            onClick={() =>
                              run(
                                () =>
                                  setBanned.mutateAsync({ userId: user.id, banned: !user.banned }),
                                user.banned ? "Account re-enabled" : "Account disabled",
                              )
                            }
                          >
                            <UserX />
                            {user.banned ? "Re-enable account" : "Disable account"}
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            variant="destructive"
                            disabled={isSelf}
                            onClick={() =>
                              setPendingDelete({
                                id: user.id,
                                name: user.name,
                                email: user.email,
                              })
                            }
                          >
                            <Trash2 />
                            Delete account
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total === 0
            ? "No users"
            : `Showing ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + users.length} of ${total}`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <TempPasswordDialog result={tempPassword} onClose={() => setTempPassword(null)} />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {pendingDelete?.email} along with their sessions. It cannot be
              undone — disable the account instead if you may need it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (!target) return;
                void run(() => deleteUser.mutateAsync({ userId: target.id }), "Account deleted");
              }}
            >
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
