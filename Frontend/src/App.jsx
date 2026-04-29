import { Navigate, Route, Routes } from "react-router-dom";

import "./App.css";
import { useAuth } from "./hooks/useAuth";
import { useRole } from "./hooks/useRole";
import { roleDashboardPath } from "./lib/roles";
import AccessDenied from "./pages/AccessDenied";
import AuthPage from "./pages/auth/AuthPage";
import DashboardPage from "./pages/dashboard/DashboardPage";
import CoursesPage from "./pages/curriculum/CoursesPage";
import MaterialsPage from "./pages/curriculum/MaterialsPage";
import AssignmentsPage from "./pages/curriculum/AssignmentsPage";

function FullscreenState({ title, message }) {
  return (
    <section className="fullscreen-state">
      <div className="fullscreen-state__aurora fullscreen-state__aurora--blue" />
      <div className="fullscreen-state__aurora fullscreen-state__aurora--gold" />
      <div className="fullscreen-state__card">
        <div className="fullscreen-state__status">
          <span className="fullscreen-state__pulse" aria-hidden="true" />
          <span>Secure session check</span>
        </div>
        <p className="eyebrow">UniSystem</p>
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="fullscreen-state__progress" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <small className="fullscreen-state__caption">
          Restoring your workspace and permissions.
        </small>
      </div>
    </section>
  );
}

function RequireSession({ children }) {
  const { loading, session } = useAuth();

  if (loading) {
    return <FullscreenState title="Loading session" message="Checking your Supabase login state..." />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function RoleGuard({ allowedRoles, children }) {
  const { loading, profile } = useAuth();
  const { role } = useRole();

  if (loading) {
    return <FullscreenState title="Loading profile" message="Reading your role from profiles..." />;
  }

  if (!profile?.role) {
    return <AccessDenied message="Access denied: role is missing." />;
  }

  if (profile.role === "admin") {
    return children;
  }

  if (!allowedRoles.includes(role)) {
    return <AccessDenied message="Access denied: you do not have permission for this page." />;
  }

  return children;
}

function RootRedirect() {
  const { loading, session, profile } = useAuth();

  if (loading) {
    return <FullscreenState title="Starting UniSystem" message="Preparing your dashboard..." />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!profile?.role) {
    return <AccessDenied message="Access denied: role is missing." />;
  }

  return <Navigate to={roleDashboardPath(profile.role)} replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route
        path="/dashboard/student"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["student", "admin"]}>
              <DashboardPage variant="student" />
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/dashboard/parent"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["parent", "admin"]}>
              <DashboardPage variant="parent" />
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/dashboard/staff"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["professor", "ta", "admin"]}>
              <DashboardPage variant="staff" />
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/curriculum/courses"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["admin", "professor", "ta", "student"]}>
              <CoursesPage />
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/curriculum/materials"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["admin", "professor", "ta", "student"]}>
              <MaterialsPage />
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/curriculum/assignments"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["admin", "professor", "ta", "student"]}>
              <AssignmentsPage />
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route path="/access-denied" element={<AccessDenied />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
