import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

import { BtnGhost } from "../ui/Buttons";
import { useAuth } from "../../hooks/useAuth";
import { useRole } from "../../hooks/useRole";
import { useEnrollment } from "../../hooks/useEnrollment";
import { roleDashboardPath, roleChipClass, roleLabel } from "../../lib/roles";
import { supabase } from "../../lib/supabase";

function InboxButton({ authUserId }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!authUserId) return;

    async function fetchUnread() {
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("receiver_id", authUserId)
        .eq("is_read", false);
      setUnread(count ?? 0);
    }

    fetchUnread();
  }, [authUserId]);

  return (
    <Link to="/messages" className="topbar-inbox">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
      <span>Inbox</span>
      {unread > 0 && (
        <span className="topbar-inbox__badge">{unread > 99 ? "99+" : unread}</span>
      )}
    </Link>
  );
}

export default function AppShell({ title, subtitle, children }) {
  const navigate = useNavigate();
  const { profile, session, signOut } = useAuth();
  const { role } = useRole();
  const { enrolled } = useEnrollment();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const homePath = roleDashboardPath(role);
  const isUnregistered = role === "student" && enrolled === false;
  const showInbox = !isUnregistered && (role === "student" || role === "professor" || role === "ta" || role === "admin");

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
                <NavLink className="sidebar-nav__link" to="/curriculum/courses">
                  Courses
                </NavLink>
                <NavLink className="sidebar-nav__link" to="/curriculum/grades">
                  Grades
                </NavLink>
              </>
            )}

            {(role === "admin" || role === "professor" || role === "ta") && (
              <>
                <p className="sidebar-label">Facilities</p>
                <NavLink className="sidebar-nav__link" to="/facilities">
                  Rooms &amp; Reservations
                </NavLink>
              </>
            )}

            {(role === "student" || role === "professor" || role === "ta" || role === "admin") && (
              <>
                <p className="sidebar-label">Directory</p>
                <NavLink className="sidebar-nav__link" to="/staff/directory">
                  Staff Directory
                </NavLink>
              </>
            )}

            {role === "admin" && (
              <>
                <p className="sidebar-label">People</p>
                <NavLink className="sidebar-nav__link" to="/students">
                  Users
                </NavLink>
              </>
            )}

            {(role === "student" || role === "admin") && (
              <>
                <p className="sidebar-label">Admissions</p>
                <NavLink className="sidebar-nav__link" to="/admissions">
                  {isUnregistered ? "Apply Now" : "Applications"}
                </NavLink>
              </>
            )}
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
          <div className="topbar__right">
            <Link to="/announcements" className="topbar-inbox" title="Announcements">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span>Announcements</span>
            </Link>
            {showInbox && <InboxButton authUserId={session?.user?.id} />}
          </div>
        </header>

        <main className="app-shell__content">{children}</main>
      </div>
    </div>
  );
}
