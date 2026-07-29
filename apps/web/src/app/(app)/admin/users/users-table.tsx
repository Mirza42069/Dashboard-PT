"use client";

import { roleOf, type Role } from "@DashboardV2/api/lib/permissions";
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
import {
  Building2,
  KeyRound,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  ShieldMinus,
  ShieldPlus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useDebounced } from "@/lib/use-debounced";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import CreateUserDialog from "./create-user-dialog";
import TempPasswordDialog, { type TempPasswordResult } from "./temp-password-dialog";

const PAGE_SIZE = 25;

type PendingDelete = { id: string; name: string; email: string };

export default function UsersTable({
  currentUserId,
  actorRole,
}: {
  currentUserId: string;
  actorRole: Role;
}) {
  const t = useT();
  const { formatDateTime } = useFormat();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [tempPassword, setTempPassword] = useState<TempPasswordResult | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [companyTarget, setCompanyTarget] = useState<{ id: string; name: string } | null>(null);

  const debouncedSearch = useDebounced(search);

  const usersQuery = useQuery(
    trpc.admin.listUsers.queryOptions({
      search: debouncedSearch,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
  );
  // company.list is super-admin-only server-side; a company admin never
  // moves anyone, so there is nothing to fetch for them.
  const companiesQuery = useQuery({
    ...trpc.company.list.queryOptions(),
    enabled: actorRole === "super_admin",
  });
  const companies = companiesQuery.data?.companies ?? [];

  async function refresh() {
    await queryClient.invalidateQueries(trpc.admin.pathFilter());
  }

  const resetPassword = useMutation(trpc.admin.resetPassword.mutationOptions());
  const setRole = useMutation(trpc.admin.setRole.mutationOptions());
  const setBanned = useMutation(trpc.admin.setBanned.mutationOptions());
  const setCompany = useMutation(trpc.admin.setCompany.mutationOptions());
  const deleteUser = useMutation(trpc.admin.deleteUser.mutationOptions());

  /** Every mutation here is admin-only server-side; this is just error surfacing. */
  async function run(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action();
      await refresh();
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
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
          placeholder={t.users.searchPlaceholder}
          className="w-full sm:max-w-xs"
          aria-label={t.common.search}
        />
        <CreateUserDialog actorRole={actorRole} onCreated={setTempPassword} />
      </div>

      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t.users.name}</TableHead>
                <TableHead>{t.users.email}</TableHead>
                <TableHead>{t.users.role}</TableHead>
                <TableHead>{t.company.label}</TableHead>
                <TableHead>{t.users.statusColumn}</TableHead>
                <TableHead>{t.users.created}</TableHead>
                <TableHead className="pr-4 text-right">{t.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.isPending &&
                Array.from({ length: PAGE_SIZE }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={7} className="pl-4">
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!usersQuery.isPending && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    {debouncedSearch
                      ? interpolate(t.users.noMatch, { search: debouncedSearch })
                      : t.users.empty}
                  </TableCell>
                </TableRow>
              )}

              {users.map((user) => {
                const isSelf = user.id === currentUserId;
                const role = roleOf(user);
                const isSuperAdmin = role === "super_admin";
                const isRowAdmin = role === "admin";
                // A super admin can act on anyone; a company admin only on
                // their own company's Users — mirrors assertTargetManageable
                // server-side. The only non-manageable row an admin actor
                // ever sees is a fellow admin of the same company.
                const manageable = actorRole === "super_admin" || role === "user";

                return (
                  <TableRow key={user.id}>
                    <TableCell className="pl-4 font-medium">
                      {user.name}
                      {isSelf && (
                        <span className="ml-1.5 text-muted-foreground">{t.common.you}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={isSuperAdmin ? "default" : isRowAdmin ? "secondary" : "outline"}>
                        {isSuperAdmin
                          ? t.users.roleSuperAdmin
                          : isRowAdmin
                            ? t.users.roleAdmin
                            : t.users.roleUser}
                      </Badge>
                    </TableCell>
                    {/* Super admins are unpinned by design — they pick an
                        active company from the header instead of belonging
                        to one. */}
                    <TableCell className="text-muted-foreground">
                      {user.companyName ?? t.common.none}
                    </TableCell>
                    <TableCell>
                      {user.banned ? (
                        <Badge variant="destructive">
                          <PauseCircle />
                          {t.users.paused}
                        </Badge>
                      ) : user.mustChangePassword ? (
                        <Badge variant="secondary">{t.users.pendingFirstSignIn}</Badge>
                      ) : (
                        <Badge variant="ghost">{t.users.active}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(user.createdAt)}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" />}
                          aria-label={interpolate(t.users.actionsFor, { name: user.name })}
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52 bg-card">
                          <DropdownMenuItem
                            disabled={!manageable}
                            onClick={() =>
                              run(async () => {
                                const data = await resetPassword.mutateAsync({ userId: user.id });
                                setTempPassword({
                                  email: user.email,
                                  password: data.temporaryPassword,
                                  isNewAccount: false,
                                });
                              }, t.users.passwordResetToast)
                            }
                          >
                            <KeyRound />
                            {t.users.resetPassword}
                          </DropdownMenuItem>

                          {/* Promote/demote cycles user <-> admin only — a
                              super admin is created via setRole from a
                              different flow and never shown this toggle. */}
                          {actorRole === "super_admin" && !isSuperAdmin && (
                            <DropdownMenuItem
                              onClick={() =>
                                run(
                                  () =>
                                    setRole.mutateAsync({
                                      userId: user.id,
                                      role: isRowAdmin ? "user" : "admin",
                                    }),
                                  isRowAdmin ? t.users.demotedToast : t.users.promotedToast,
                                )
                              }
                            >
                              {isRowAdmin ? <ShieldMinus /> : <ShieldPlus />}
                              {isRowAdmin ? t.users.demote : t.users.promote}
                            </DropdownMenuItem>
                          )}

                          {/* Super admins have no company to move; they pick one. */}
                          {actorRole === "super_admin" && !isSuperAdmin && (
                            <DropdownMenuItem
                              onClick={() =>
                                setCompanyTarget({ id: user.id, name: user.name })
                              }
                            >
                              <Building2 />
                              {t.company.move}
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuSeparator />

                          {/* "Pause" is the ban mechanism under a subscription-
                              lifecycle name: sign-in is refused with the
                              contact-your-admin message until resumed. */}
                          <DropdownMenuItem
                            disabled={isSelf || !manageable}
                            onClick={() =>
                              run(
                                () =>
                                  setBanned.mutateAsync({
                                    userId: user.id,
                                    banned: !user.banned,
                                    reason: user.banned ? undefined : "subscription",
                                  }),
                                user.banned
                                  ? t.users.accountResumedToast
                                  : t.users.accountPausedToast,
                              )
                            }
                          >
                            {user.banned ? <PlayCircle /> : <PauseCircle />}
                            {user.banned ? t.users.resume : t.users.pause}
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            variant="destructive"
                            disabled={isSelf || !manageable}
                            onClick={() =>
                              setPendingDelete({
                                id: user.id,
                                name: user.name,
                                email: user.email,
                              })
                            }
                          >
                            <Trash2 />
                            {t.users.deleteAccount}
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
            ? t.users.noUsers
            : interpolate(t.users.showing, {
                from: page * PAGE_SIZE + 1,
                to: page * PAGE_SIZE + users.length,
                total,
              })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            {t.common.previous}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage}
            onClick={() => setPage((value) => value + 1)}
          >
            {t.common.next}
          </Button>
        </div>
      </div>

      <TempPasswordDialog result={tempPassword} onClose={() => setTempPassword(null)} />

      {/* Moving an account between companies changes everything it can see, so
          it is an explicit pick rather than a cycle-through. */}
      <AlertDialog
        open={companyTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCompanyTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.company.moveTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {interpolate(t.company.moveDescription, { name: companyTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            {companies.map((item) => (
              <Button
                key={item.id}
                variant="outline"
                className="justify-start"
                onClick={() => {
                  const target = companyTarget;
                  setCompanyTarget(null);
                  if (!target) return;
                  void run(
                    () => setCompany.mutateAsync({ userId: target.id, companyId: item.id }),
                    t.company.moved,
                  );
                }}
              >
                <Building2 />
                {item.name}
              </Button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {interpolate(t.users.deleteTitle, { name: pendingDelete?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {interpolate(t.users.deleteDescription, { email: pendingDelete?.email ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (!target) return;
                void run(
                  () => deleteUser.mutateAsync({ userId: target.id }),
                  t.users.deletedToast,
                );
              }}
            >
              {t.users.deleteConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
