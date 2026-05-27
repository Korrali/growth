import type { Role } from "@prisma/client";

export class ForbiddenError extends Error {
  public readonly requiredRoles: Role[];
  public readonly actualRole: Role;

  constructor(requiredRoles: Role[], actualRole: Role) {
    super(
      `Forbidden: this action requires ${requiredRoles.join(" or ")}; you are ${actualRole}.`,
    );
    this.name = "ForbiddenError";
    this.requiredRoles = requiredRoles;
    this.actualRole = actualRole;
  }
}

const ROLE_RANK: Record<Role, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

export function hasRole(actual: Role, minRole: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[minRole];
}

export async function requireRole(minRole: Role) {
  const { requireOrgContext } = await import("@/lib/org-context");
  const ctx = await requireOrgContext();
  if (!hasRole(ctx.role, minRole)) {
    throw new ForbiddenError([minRole], ctx.role);
  }
  return ctx;
}
