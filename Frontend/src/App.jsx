import { Navigate, Route, Routes } from "react-router-dom";

import "./App.css";
import { useAuth } from "./hooks/useAuth";
import { useRole } from "./hooks/useRole";
import { useEnrollment } from "./hooks/useEnrollment";
import { roleDashboardPath } from "./lib/roles";
import AccessDenied from "./pages/AccessDenied";
import AuthPage from "./pages/auth/AuthPage";
import AnnouncementsPage from "./pages/announcements/AnnouncementsPage";
import DashboardPage from "./pages/dashboard/DashboardPage";
import CoursesPage from "./pages/curriculum/CoursesPage";
import CourseDetailPage from "./pages/curriculum/CourseDetailPage";
import MaterialsPage from "./pages/curriculum/MaterialsPage";
import AssignmentsPage from "./pages/curriculum/AssignmentsPage";
import GradesPage from "./pages/curriculum/GradesPage";
import MessagesPage from "./pages/messages/MessagesPage";
import AdmissionsPage from "./pages/admissions/AdmissionsPage";
import FacilitiesPage from "./pages/facilities/FacilitiesPage";
import StudentsPage from "./pages/students/StudentsPage";
import StaffDirectoryPage from "./pages/staff/StaffDirectoryPage";
import CompleteProfilePage from "./pages/auth/CompleteProfilePage";

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
  const { loading, session, profile } = useAuth();

  if (loading) {
    return <FullscreenState title="Loading session" message="Checking your Supabase login state..." />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (profile?.must_change_password) {
    return <Navigate to="/complete-profile" replace />;
  }

  return children;
}

// Lighter guard used only for /complete-profile so it doesn't redirect to itself
function RequireSessionOnly({ children }) {
  const { loading, session } = useAuth();

  if (loading) {
    return <FullscreenState title="Loading session" message="Checking your login state..." />;
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

function RequireEnrolled({ children }) {
  const { role } = useRole();
  const { enrolled, loading } = useEnrollment();

  if (role !== "student") return children;
  if (loading) return <FullscreenState title="Checking enrollment" message="Verifying your student record…" />;
  if (!enrolled) return <Navigate to="/dashboard/student" replace />;
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

  if (profile?.must_change_password) {
    return <Navigate to="/complete-profile" replace />;
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
        path="/curriculum/courses/:id"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["admin", "professor", "ta", "student"]}>
              <CourseDetailPage />
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/curriculum/materials"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["admin", "professor", "ta", "student"]}>
              <RequireEnrolled>
                <MaterialsPage />
              </RequireEnrolled>
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/curriculum/assignments"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["admin", "professor", "ta", "student"]}>
              <RequireEnrolled>
                <AssignmentsPage />
              </RequireEnrolled>
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/curriculum/grades"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["admin", "professor", "ta", "student"]}>
              <GradesPage />
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/announcements"
        element={
          <RequireSession>
            <AnnouncementsPage />
          </RequireSession>
        }
      />
      <Route
        path="/messages"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["student", "professor", "ta", "admin"]}>
              <RequireEnrolled>
                <MessagesPage />
              </RequireEnrolled>
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/facilities"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["admin", "professor", "ta"]}>
              <FacilitiesPage />
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/students"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["admin"]}>
              <StudentsPage />
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/staff/directory"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["student", "professor", "ta", "admin"]}>
              <StaffDirectoryPage />
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/admissions"
        element={
          <RequireSession>
            <RoleGuard allowedRoles={["student", "admin"]}>
              <AdmissionsPage />
            </RoleGuard>
          </RequireSession>
        }
      />
      <Route
        path="/complete-profile"
        element={
          <RequireSessionOnly>
            <CompleteProfilePage />
          </RequireSessionOnly>
        }
      />
      <Route path="/access-denied" element={<AccessDenied />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
