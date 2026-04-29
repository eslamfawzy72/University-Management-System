import { Link, NavLink, useNavigate } from "react-router-dom";

import { BtnGhost } from "../ui/Buttons";
import { useAuth } from "../../hooks/useAuth";
import { useRole } from "../../hooks/useRole";
import { roleDashboardPath, roleChipClass, roleLabel } from "../../lib/roles";

export default function AppShell({ title, subtitle, children }) {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const { role } = useRole();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const homePath = roleDashboardPath(role);

  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <div>
          <Link className="brand" to={homePath}>
            <span className="brand__mark">U</span>
            <span>
              <strong>UniSystem</strong>
              <small>University Management</small>
            </span>
          </Link>

          <div className="sidebar-card">
            <span className={`chip ${roleChipClass(role)}`}>{roleLabel(role)}</span>
            <h2>{profile?.full_name || "Welcome"}</h2>
            <p>{profile?.email || "Signed in session"}</p>
          </div>

          <nav className="sidebar-nav">
            <NavLink className="sidebar-nav__link" to={homePath} end>
              Dashboard
            </NavLink>

            {role !== "parent" && (
              <>
                <p className="sidebar-label">Curriculum</p>
                <NavLink className="sidebar-nav__link" to="/curriculum/courses">
                  Courses
                </NavLink>
                <NavLink className="sidebar-nav__link" to="/curriculum/materials">
                  Materials
                </NavLink>
                <NavLink className="sidebar-nav__link" to="/curriculum/assignments">
                  Assignments
                </NavLink>
              </>
            )}
            <NavLink className="sidebar-nav__link" to="/announcements">
              Announcements
            </NavLink>
          </nav>
        </div>

        <BtnGhost className="sidebar-signout" onClick={handleSignOut}>
          Sign out
        </BtnGhost>
      </aside>

      <div className="app-shell__main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{roleLabel(role)} access</p>
            <h1>{title}</h1>
          </div>
          <p className="topbar__subtitle">{subtitle}</p>
        </header>

        <main className="app-shell__content">{children}</main>
      </div>
    </div>
  );
}
