import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";

import { useAuth } from "../../hooks/useAuth";
import { useRole } from "../../hooks/useRole";
import { useEnrollment } from "../../hooks/useEnrollment";
import { useTheme } from "../../context/ThemeContext";
import { roleDashboardPath, roleChipClass, roleLabel } from "../../lib/roles";
import { supabase } from "../../lib/supabase";

function InboxButton({ authUserId }) {
  const [unread, setUnread] = useState(0);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!authUserId) return;

    if (pathname === "/messages") {
      setUnread(0);
      return;
    }

    async function fetchUnread() {
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("receiver_id", authUserId)
        .eq("is_read", false);
      setUnread(count ?? 0);
    }

    fetchUnread();
  }, [authUserId, pathname]);

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
  const { theme, toggle } = useTheme();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const homePath = roleDashboardPath(role);
  const isUnregistered = role === "student" && enrolled === false;
  const showInbox = !isUnregistered && (role === "student" || role === "professor" || role === "ta" || role === "admin" || role === "parent");
  const isStaff = role === "professor" || role === "ta" || role === "admin";

  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <div className="sidebar-top">
          <Link className="brand" to={homePath}>
            <span className="brand__mark">U</span>
            <span>
              <strong>UniSystem</strong>
              <small>University Management</small>
            </span>
          </Link>

          <div className="sidebar-card">
            <span className={`chip chip-sm ${roleChipClass(role)}`}>{roleLabel(role)}</span>
            {isStaff ? (
              <NavLink to="/staff/profile" className="sidebar-card__link">
                <p className="sidebar-card__name">{profile?.full_name || "Welcome"}</p>
                <p className="sidebar-card__email">{profile?.email || "Signed in"}</p>
              </NavLink>
            ) : (
              <>
                <p className="sidebar-card__name">{profile?.full_name || "Welcome"}</p>
                <p className="sidebar-card__email">{profile?.email || "Signed in"}</p>
              </>
            )}
          </div>

          <nav className="sidebar-nav">
            <NavLink className="sidebar-nav__link" to={homePath} end>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              Dashboard
            </NavLink>

            {role !== "parent" && (
              <>
                <NavLink className="sidebar-nav__link" to="/curriculum/courses">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                  Courses
                </NavLink>
                <NavLink className="sidebar-nav__link" to="/curriculum/grades">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  Grades
                </NavLink>
              </>
            )}

            {(role === "admin" || role === "professor" || role === "ta") && (
              <>
                <p className="sidebar-label">Facilities</p>
                <NavLink className="sidebar-nav__link" to="/facilities">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                  Rooms &amp; Reservations
                </NavLink>
              </>
            )}

            {(role === "student" || role === "professor" || role === "ta" || role === "admin") && (
              <>
                <p className="sidebar-label">Directory</p>
                <NavLink className="sidebar-nav__link" to="/staff/directory">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  Staff Directory
                </NavLink>
              </>
            )}

            {role === "admin" && (
              <>
                <p className="sidebar-label">People</p>
                <NavLink className="sidebar-nav__link" to="/students">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  Users
                </NavLink>
              </>
            )}

            {(role === "student" || role === "admin") && (
              <>
                <p className="sidebar-label">Admissions</p>
                <NavLink className="sidebar-nav__link" to="/admissions">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                  {isUnregistered ? "Apply Now" : "Applications"}
                </NavLink>
              </>
            )}
          </nav>
        </div>

        <button className="sidebar-signout" onClick={handleSignOut}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign out
        </button>
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
            <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme" title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}>
              {theme === "light" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              )}
            </button>
          </div>
        </header>

        <main className="app-shell__content">{children}</main>
      </div>
    </div>
  );
}
