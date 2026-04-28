import { useAuth } from "./useAuth";

export function useRole() {
  const { profile } = useAuth();
  const role = profile?.role ?? null;

  return {
    role,
    is(targetRole) {
      return role === targetRole;
    },
    isAny(targetRoles) {
      return Boolean(role) && targetRoles.includes(role);
    },
  };
}
