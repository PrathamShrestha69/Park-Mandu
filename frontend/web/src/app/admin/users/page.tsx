import { Plus, Search, Users } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { Badge, ChipLink, Chips, EmptyState, PageHead, Pagination, PageSkeleton, surface } from "@/components/common";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setUserStatusAction } from "@/lib/actions/operations";
import { apiGet } from "@/lib/api";
import { pageParam, param } from "@/lib/api-query";
import { getViewer } from "@/lib/dal";
import { formatDate } from "@/lib/format";
import type { Page, RoleCounts, User } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "User management" };

const ROLE_LABEL = { public: "Public user / Landowner", police: "Traffic police", admin: "Administrator" } as const;
const STATUS_TONE = { active: "success", pending: "warning", suspended: "danger" } as const;

function StatusAction({ user, self }: { user: User; self: boolean }) {
  if (self) return <small className="text-xs text-muted-foreground">You</small>;
  const suspend = user.status !== "suspended";
  return (
    <form action={setUserStatusAction}>
      <input type="hidden" name="user_id" value={user.id} />
      <input type="hidden" name="status" value={suspend ? "suspended" : "active"} />
      <Button type="submit" size="sm" variant={suspend ? "ghost" : "outline"} className={suspend ? "text-muted-foreground hover:text-destructive" : undefined}>
        {suspend ? "Suspend" : "Reactivate"}
      </Button>
    </form>
  );
}

function UserStatus({ u }: { u: User }) {
  const onDuty = u.role === "police" && u.on_duty && u.status === "active";
  return (
    <Badge tone={onDuty ? "info" : STATUS_TONE[u.status]} live={onDuty}>
      {onDuty ? "On duty" : u.status[0].toUpperCase() + u.status.slice(1)}
    </Badge>
  );
}

async function UsersPageContent(props: PageProps<"/admin/users">) {
  const params = await props.searchParams;
  const filters = { q: param(params, "q"), role: param(params, "role"), status: param(params, "status"), sort: param(params, "sort") };
  const [viewer, counts, users] = await Promise.all([
    getViewer(),
    apiGet<RoleCounts>("/admin/users/counts"),
    apiGet<Page<User>>("/admin/users", { ...filters, page: pageParam(params), size: 15 }),
  ]);

  return (
    <>
      <PageHead
        title="Users"
        subtitle={`${counts.total.toLocaleString()} registered service users`}
        back="/admin"
        actions={
          <Button asChild>
            <Link href="/admin/users/new">
              <Plus /> Add staff
            </Link>
          </Button>
        }
      />
      <form role="search" action="/admin/users" className="flex flex-wrap gap-2">
        {filters.role && <input type="hidden" name="role" value={filters.role} />}
        <InputGroup className="h-10 min-w-56 flex-1">
          <InputGroupInput name="q" autoComplete="off" defaultValue={filters.q} placeholder="Search name, phone, email or badge" aria-label="Search users" />
          <InputGroupAddon className="pl-3">
            <Search />
          </InputGroupAddon>
        </InputGroup>
        <NativeSelect name="status" defaultValue={filters.status ?? ""} aria-label="Account status">
          <NativeSelectOption value="">Any status</NativeSelectOption>
          <NativeSelectOption value="active">Active</NativeSelectOption>
          <NativeSelectOption value="suspended">Suspended</NativeSelectOption>
        </NativeSelect>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      <Chips className="mt-4">
        <ChipLink basePath="/admin/users" query={filters} param="role" value={undefined} current={filters.role} count={counts.total}>
          All users
        </ChipLink>
        <ChipLink basePath="/admin/users" query={filters} param="role" value="public" current={filters.role} count={counts.public}>
          Public / landowners
        </ChipLink>
        <ChipLink basePath="/admin/users" query={filters} param="role" value="police" current={filters.role} count={counts.police}>
          Traffic police
        </ChipLink>
        <ChipLink basePath="/admin/users" query={filters} param="role" value="admin" current={filters.role} count={counts.admin}>
          Administrators
        </ChipLink>
      </Chips>

      {users.items.length ? (
        <>
          <div className={cn(surface, "mt-4 hidden overflow-hidden lg:block")}>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="h-10 pl-5 text-xs">Name</TableHead>
                  <TableHead className="h-10 text-xs">Role</TableHead>
                  <TableHead className="h-10 text-xs">Status</TableHead>
                  <TableHead className="h-10 text-xs">Registered</TableHead>
                  <TableHead className="h-10 pr-5">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="py-3 pl-5">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-9">
                          <AvatarFallback className="bg-brand/12 text-xs font-semibold text-brand-ink">{u.initials}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <strong className="block font-medium">{u.full_name}</strong>
                          <span className="block text-xs text-muted-foreground">
                            {u.badge_number ? `${u.designation} · ${u.badge_number}` : (u.email ?? u.phone)}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{ROLE_LABEL[u.role]}</TableCell>
                    <TableCell>
                      <UserStatus u={u} />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{formatDate(u.created_at)}</TableCell>
                    <TableCell className="pr-5 text-right">
                      <StatusAction user={u} self={u.id === viewer.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className={cn(surface, "mt-4 overflow-hidden lg:hidden")}>
            {users.items.map((u) => (
              <li key={u.id} className="flex items-center gap-3 border-b px-4 py-3.5 last:border-b-0">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-brand/12 text-xs font-semibold text-brand-ink">{u.initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm font-medium">{u.full_name}</strong>
                  <p className="truncate text-xs text-muted-foreground">{ROLE_LABEL[u.role]}</p>
                  <div className="mt-1.5">
                    <UserStatus u={u} />
                  </div>
                </div>
                <StatusAction user={u} self={u.id === viewer.id} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="mt-4">
          <EmptyState icon={<Users />} title="No users found" body="Try another name or clear the filters." />
        </div>
      )}
      <Pagination page={users.page} pages={users.pages} total={users.total} basePath="/admin/users" query={filters} />
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function UsersPage(props: PageProps<"/admin/users">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UsersPageContent {...props} />
    </Suspense>
  );
}
