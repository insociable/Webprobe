export type OrganizationRole = "owner" | "admin" | "member";

export function canManageOrganization(role: OrganizationRole): boolean {
  return role === "owner" || role === "admin";
}
