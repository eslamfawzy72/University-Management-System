export const ROLE_DASHBOARD_PATHS = {
  student: "/dashboard/student",
  parent: "/dashboard/parent",
  professor: "/dashboard/staff",
  ta: "/dashboard/staff",
  admin: "/dashboard/staff",
};

export function roleDashboardPath(role) {
  return ROLE_DASHBOARD_PATHS[role] ?? "/login";
}

export function roleLabel(role) {
  switch (role) {
    case "student":
      return "Student";
    case "parent":
      return "Parent";
    case "professor":
      return "Professor";
    case "ta":
      return "TA";
    case "admin":
      return "Admin";
    default:
      return "Unknown";
  }
}

export function roleChipClass(role) {
  switch (role) {
    case "student":
      return "chip-green";
    case "parent":
      return "chip-gray";
    case "professor":
      return "chip-blue";
    case "ta":
      return "chip-gold";
    case "admin":
      return "chip-navy";
    default:
      return "chip-gray";
  }
}

export function isStaffRole(role) {
  return role === "professor" || role === "ta" || role === "admin";
}
