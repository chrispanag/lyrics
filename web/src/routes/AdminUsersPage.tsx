import { useState } from "react";
import { Navigate } from "react-router-dom";

import { errorMessage } from "@/api/client";
import { useSetUserRole, useUsers } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { ErrorMessage, Input, Select, Skeleton, Spinner } from "@/components/ui";
import { useDebounced } from "@/lib/useDebounced";
import { ROLES, hasRole, type Role } from "@/lib/types";

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  user: "Can browse and build lists",
  contributor: "Can also add songs and edit their own",
  admin: "Full access, including deleting anything",
};

export function AdminUsersPage() {
  const { user, loading } = useAuth();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [error, setError] = useState("");

  const debouncedSearch = useDebounced(search, 250);
  const { data, isLoading } = useUsers(debouncedSearch, roleFilter);
  const setRole = useSetUserRole();

  if (loading) return <Spinner />;
  if (!hasRole(user?.role, "admin")) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Users</h1>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          type="search"
          placeholder="Search by email or name"
          aria-label="Search users"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="flex-1"
        />
        <Select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          className="sm:w-44"
        >
          <option value="">All roles</option>
          {ROLES.map((role) => (
            <option key={role} value={role} className="capitalize">
              {role}
            </option>
          ))}
        </Select>
      </div>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      )}

      <ul className="space-y-2">
        {data?.data.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800 dark:bg-stone-900"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{row.display_name ?? row.email}</p>
              {row.display_name && (
                <p className="truncate text-sm text-stone-500 dark:text-stone-400">{row.email}</p>
              )}
              <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                {ROLE_DESCRIPTIONS[row.role]}
              </p>
            </div>

            <Select
              aria-label={`Role for ${row.email}`}
              value={row.role}
              disabled={setRole.isPending}
              onChange={(event) => {
                setError("");
                setRole.mutate(
                  { id: row.id, role: event.target.value },
                  {
                    onError: (caught) =>
                      setError(errorMessage(caught, "That role change could not be applied.")),
                  },
                );
              }}
              className="w-full shrink-0 capitalize sm:w-44"
            >
              {ROLES.map((role) => (
                <option key={role} value={role} className="capitalize">
                  {role}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>

      {!isLoading && data?.data.length === 0 && (
        <p className="py-10 text-center text-sm text-stone-500">No users matched.</p>
      )}
    </div>
  );
}
