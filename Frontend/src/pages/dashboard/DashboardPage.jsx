import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";

import AppShell from "../../components/layout/AppShell";
import { BtnPrimary, BtnGhost } from "../../components/ui/Buttons";
import { useAuth } from "../../hooks/useAuth";
import { useEnrollment } from "../../hooks/useEnrollment";
import { roleChipClass, roleLabel } from "../../lib/roles";
import { supabase } from "../../lib/supabase";
import TaAssignedCoursesPanel from "./TaAssignedCoursesPanel";

const DASHBOARD_HIGHLIGHTS = {
  student: [
    "Enrolled course materials are available for instant reading.",
    "Assignment deadlines stay visible in the dashboard timeline.",
    "Grades and feedback stay tied to your profile.",
  ],
  staff: [
    "Publish materials and assignments to assigned courses.",
    "Review submissions and record grades for your classes.",
    "Coordinate with students and parents through messages.",
  ],
};

function useStudentStats(profileId) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;

    async function load() {
      const { data: studentRec } = await supabase
        .from("students")
        .select("id")
        .eq("profile_id", profileId)
        .maybeSingle();

      if (!studentRec || cancelled) return;
      const studentId = studentRec.id;

      const [enrollRes, gradesRes, submissionsRes] = await Promise.all([
        supabase
          .from("course_enrollments")
          .select("course_id")
          .eq("student_id", studentId)
          .eq("status", "enrolled"),
        supabase
          .from("assignment_grades")
          .select("score, max_score")
          .eq("student_id", studentId),
        supabase
          .from("assignment_submissions")
          .select("assignment_id")
          .eq("student_id", studentId),
      ]);

      if (cancelled) return;

      const enrolledCourseIds = (enrollRes.data ?? []).map((e) => e.course_id);
      const courseCount = enrolledCourseIds.length;

      const grades = gradesRes.data ?? [];
      const avg = grades.length
        ? Math.round(grades.reduce((sum, g) => sum + (g.max_score ? (g.score / g.max_score) * 100 : 0), 0) / grades.length)
        : null;

      const submittedIds = new Set((submissionsRes.data ?? []).map((s) => s.assignment_id));

      let pendingCount = 0;
      if (enrolledCourseIds.length > 0) {
        const { data: upcomingAssignments } = await supabase
          .from("assignments")
          .select("id")
          .eq("is_published", true)
          .gt("due_date", new Date().toISOString())
          .in("course_id", enrolledCourseIds);
        if (!cancelled) {
          pendingCount = (upcomingAssignments ?? []).filter((a) => !submittedIds.has(a.id)).length;
        }
      }

      if (!cancelled) {
        setStats({
          courses: courseCount,
          pending: pendingCount,
          avg: avg !== null ? `${avg}%` : "—",
        });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [profileId]);

  return stats;
}

function useStaffStats(profileId) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;

    async function load() {
      const [staffRecRes, assignmentsRes, announcementsRes] = await Promise.all([
        supabase.from("staff").select("id").eq("profile_id", profileId).maybeSingle(),
        supabase.from("assignments").select("id").eq("created_by", profileId),
        supabase.from("announcements").select("id", { count: "exact", head: true }).eq("author_id", profileId),
      ]);

      if (cancelled) return;

      const staffRec = staffRecRes.data;
      const assignmentIds = (assignmentsRes.data ?? []).map((a) => a.id);

      const [coursesRes, submissionsRes] = await Promise.all([
        staffRec
          ? supabase
              .from("course_staff")
              .select("courses!inner(id)", { count: "exact", head: true })
              .eq("staff_id", staffRec.id)
              .eq("courses.is_active", true)
          : Promise.resolve({ count: 0 }),
        assignmentIds.length
          ? supabase
              .from("assignment_submissions")
              .select("id", { count: "exact", head: true })
              .in("assignment_id", assignmentIds)
          : Promise.resolve({ count: 0 }),
      ]);

      if (cancelled) return;

      setStats({
        activeCourses: coursesRes.count ?? 0,
        submissions: submissionsRes.count ?? 0,
        announcements: announcementsRes.count ?? 0,
      });
    }

    load();
    return () => { cancelled = true; };
  }, [profileId]);

  return stats;
}

function appStatusChipClass(status) {
  switch (status) {
    case "approved": return "chip chip-green";
    case "rejected": return "chip chip-red";
    default: return "chip chip-gold";
  }
}

function appStatusLabel(status) {
  if (!status || status === "pending") return "Pending Review";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function DocumentUploadBanner({ profileId }) {
  const [app,       setApp]       = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [docFile,   setDocFile]   = useState(null);
  const [docError,  setDocError]  = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploaded,  setUploaded]  = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!profileId) return;

    async function load() {
      const { data } = await supabase
        .from("admission_applications")
        .select("id, documents_url")
        .eq("applicant_id", profileId)
        .eq("status", "approved")
        .maybeSingle();

      if (!data || data.documents_url) { setApp(null); setLoading(false); return; }

      // No document on record. For admin-created students the DB update can
      // silently fail if the RLS policy doesn't grant students UPDATE on this
      // table. Check storage directly so the banner doesn't keep reappearing
      // after a successful upload.
      const { data: files } = await supabase.storage
        .from("admission-docs")
        .list(profileId, { limit: 1 });

      if (files?.length) {
        // File already in storage – try to sync URL back to the DB (best-effort;
        // may silently fail under restrictive RLS, but the banner stays hidden).
        const { data: { publicUrl } } = supabase.storage
          .from("admission-docs")
          .getPublicUrl(`${profileId}/${files[0].name}`);
        await supabase
          .from("admission_applications")
          .update({ documents_url: publicUrl })
          .eq("id", data.id);
        setApp(null);
      } else {
        setApp(data);
      }
      setLoading(false);
    }

    load();
  }, [profileId]);

  if (loading || !app || uploaded) return null;

  async function handleUpload(e) {
    e.preventDefault();
    if (!docFile) { setDocError("Please select a file."); return; }
    setDocError("");
    setUploading(true);

    const filePath = `${profileId}/${Date.now()}-${docFile.name}`;
    const { data: stored, error: storeErr } = await supabase.storage
      .from("admission-docs")
      .upload(filePath, docFile);
    if (storeErr) { setDocError(storeErr.message); setUploading(false); return; }

    const { data: { publicUrl } } = supabase.storage
      .from("admission-docs")
      .getPublicUrl(stored.path);

    const { error: updateErr } = await supabase
      .from("admission_applications")
      .update({ documents_url: publicUrl })
      .eq("id", app.id);

    setUploading(false);
    if (updateErr) { setDocError(updateErr.message); return; }
    // If the update silently returned 0 rows (RLS gap), the file is still in
    // storage and will be detected on next load via storage.list().
    setUploaded(true);
  }

  return (
    <article className="content-card doc-upload-card">
      <h2>Action Required: Upload Your Admission Document</h2>
      <p className="text-muted" style={{ marginTop: 6, marginBottom: 16 }}>
        Your admission has been approved. Please upload your supporting document to complete
        your registration.
      </p>
      <form onSubmit={handleUpload}>
        <div className="field">
          <span>
            Supporting Document <span className="text-danger" aria-hidden="true">*</span>
          </span>
          <input
            ref={fileRef}
            type="file"
            className="file-input"
            onChange={(e) => { setDocFile(e.target.files[0] || null); setDocError(""); }}
          />
          {docError
            ? <small style={{ color: "var(--danger)" }}>{docError}</small>
            : <small style={{ color: "var(--text-muted)" }}>Accepted: PDF, images, Word documents</small>}
        </div>
        <div style={{ marginTop: 8 }}>
          <BtnPrimary type="submit" disabled={uploading}>
            {uploading ? "Uploading…" : "Upload Document"}
          </BtnPrimary>
        </div>
      </form>
    </article>
  );
}

function UnregisteredStudentDashboard() {
  const { profile } = useAuth();
  const [application, setApplication] = useState(null);
  const [appLoading, setAppLoading] = useState(true);

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from("admission_applications")
      .select("status, submitted_at")
      .eq("applicant_id", profile.id)
      .maybeSingle()
      .then(({ data }) => {
        setApplication(data ?? null);
        setAppLoading(false);
      });
  }, [profile?.id]);

  const hasApp = !!application;

  return (
    <AppShell title="Welcome to UniSystem">
      <section className="dashboard-stack">
        <div className="chip-row">
          <span className="chip chip-green">Student</span>
          <span className="chip chip-gold">Pending Registration</span>
        </div>

        <article className="content-card">
          <h2>Admission Application</h2>

          {appLoading && (
            <p className="text-muted" style={{ marginTop: 12 }}>Loading…</p>
          )}

          {!appLoading && !hasApp && (
            <div style={{ marginTop: 12 }}>
              <p className="text-muted">
                You haven&apos;t submitted an admission application yet. Apply below to start
                your registration process.
              </p>
              <Link to="/admissions" style={{ marginTop: 16, display: "inline-block" }}>
                <BtnPrimary>Apply Now →</BtnPrimary>
              </Link>
            </div>
          )}

          {!appLoading && hasApp && (
            <div className="admission-status-grid">
              <div className="admission-status-item">
                <p className="eyebrow">Status</p>
                <span className={appStatusChipClass(application.status)}>
                  {appStatusLabel(application.status)}
                </span>
              </div>
              <div className="admission-status-item">
                <p className="eyebrow">Submitted on</p>
                <p className="admission-status-value">
                  {new Date(application.submitted_at).toLocaleDateString()}
                </p>
              </div>
              <div className="admission-status-item">
                <p className="eyebrow">Track application</p>
                <Link to="/admissions" className="text-link">
                  View details →
                </Link>
              </div>
            </div>
          )}
        </article>

        <article className="content-card">
          <h2>What&apos;s next</h2>
          <ul className="feature-list">
            <li>Submit your admission application if you haven&apos;t already.</li>
            <li>The admissions team will review your documents and credentials.</li>
            <li>Once approved and registered, you gain full access to courses, materials, assignments, and messaging.</li>
            <li>Return to this page anytime to track your application status.</li>
          </ul>
        </article>

        <article className="content-card">
          <h2>Quick links</h2>
          <ul className="feature-list">
            <li>
              <Link to="/admissions" className="text-link">
                {hasApp ? "View your application →" : "Submit your application →"}
              </Link>
            </li>
            <li>
              <Link to="/announcements" className="text-link">
                View university announcements →
              </Link>
            </li>
            <MaintenanceReportButton submitterId={profile?.id} />
          </ul>
        </article>
      </section>
    </AppShell>
  );
}

function MaintenanceReportButton({ submitterId }) {
  const [open,        setOpen]        = useState(false);
  const [rooms,       setRooms]       = useState([]);
  const [roomId,      setRoomId]      = useState("");
  const [description, setDescription] = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState("");
  const [success,     setSuccess]     = useState(false);

  function openModal() {
    setOpen(true);
    setSuccess(false);
    setError("");
    setDescription("");
    if (rooms.length === 0) {
      supabase.from("rooms").select("id, name, building").order("name")
        .then(({ data }) => {
          const list = data || [];
          setRooms(list);
          if (list.length > 0) setRoomId(list[0].id);
        });
    }
  }

  async function handleSubmit() {
    if (!description.trim()) { setError("Please describe the issue."); return; }
    if (!roomId)              { setError("Please select a room.");      return; }
    setSubmitting(true);
    setError("");
    const { error: err } = await supabase.from("maintenance_requests").insert({
      room_id:      roomId,
      submitted_by: submitterId,
      description:  description.trim(),
      status:       "open",
    });
    setSubmitting(false);
    if (err) { setError(err.message); return; }
    setSuccess(true);
  }

  return (
    <>
      <li>
        <button
          className="text-link"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit", color: "inherit" }}
          onClick={openModal}
        >
          Report a maintenance issue →
        </button>
      </li>

      {open && (
        <div className="modal-overlay" onClick={() => { if (!submitting) setOpen(false); }}>
          <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
            {success ? (
              <>
                <h2 className="modal__title">Request Submitted</h2>
                <p className="modal__body">Your maintenance request has been logged. The admin will review it shortly.</p>
                <div className="modal-actions">
                  <BtnPrimary onClick={() => setOpen(false)}>Done</BtnPrimary>
                </div>
              </>
            ) : (
              <>
                <h2 className="modal__title">Report Maintenance Issue</h2>
                {error && <p className="error-msg">{error}</p>}
                <div className="auth-form">
                  <div className="field">
                    <span>Room <span className="text-danger">*</span></span>
                    <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                      {rooms.length === 0 && <option value="">Loading rooms…</option>}
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}{r.building ? ` — ${r.building}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <span>Description <span className="text-danger">*</span></span>
                    <textarea
                      rows={3}
                      placeholder="Describe the issue (e.g. projector not working, AC broken…)"
                      value={description}
                      onChange={(e) => { setDescription(e.target.value); setError(""); }}
                    />
                  </div>
                </div>
                <div className="modal-actions">
                  <BtnGhost onClick={() => setOpen(false)}>Cancel</BtnGhost>
                  <BtnPrimary disabled={submitting} onClick={handleSubmit}>
                    {submitting ? "Submitting…" : "Submit Request"}
                  </BtnPrimary>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function StudentSummaryGrid({ profileId }) {
  const stats = useStudentStats(profileId);
  const items = [
    { label: "Enrolled courses", value: stats?.courses ?? "—" },
    { label: "Pending tasks", value: stats?.pending ?? "—" },
    { label: "Average grade", value: stats?.avg ?? "—" },
  ];
  return (
    <div className="summary-grid">
      {items.map((item) => (
        <article key={item.label} className="summary-card">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </div>
  );
}

function StaffSummaryGrid({ profileId }) {
  const stats = useStaffStats(profileId);
  const items = [
    { label: "Active courses", value: stats?.activeCourses ?? "—" },
    { label: "Submissions", value: stats?.submissions ?? "—" },
    { label: "Announcements", value: stats?.announcements ?? "—" },
  ];
  return (
    <div className="summary-grid">
      {items.map((item) => (
        <article key={item.label} className="summary-card">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </div>
  );
}

export default function DashboardPage({ variant }) {
  const { profile } = useAuth();
  const { enrolled } = useEnrollment();

  // Unregistered student: dedicated dashboard
  if (variant === "student") {
    if (enrolled === null) {
      return (
        <AppShell title="Student Dashboard">
          <p className="text-muted">Loading…</p>
        </AppShell>
      );
    }
    if (!enrolled) return <UnregisteredStudentDashboard />;
  }

  const currentRole = profile?.role ?? variant;
  const isTaDashboard = variant === "staff" && currentRole === "ta";

  const title = variant === "student"
    ? "Student dashboard"
    : isTaDashboard
    ? "TA dashboard"
    : "Staff dashboard";

  const subtitle = variant === "student"
    ? "Track classes, submissions, and grades from one place."
    : isTaDashboard
    ? "Review your assigned courses and current responsibilities."
    : "Manage teaching tasks, materials, and communication.";

  const highlights = DASHBOARD_HIGHLIGHTS[variant === "student" ? "student" : "staff"];

  return (
    <AppShell title={title} subtitle={subtitle}>
      <section className="dashboard-stack">
        <div className="chip-row">
          <span className={`chip ${roleChipClass(currentRole)}`}>{roleLabel(currentRole)}</span>
          <span className="chip chip-gray">Signed in</span>
        </div>

        {variant === "student" && <DocumentUploadBanner profileId={profile?.id} />}

        {isTaDashboard ? (
          <TaAssignedCoursesPanel />
        ) : (
          <>
            {variant === "student"
              ? <StudentSummaryGrid profileId={profile?.id} />
              : <StaffSummaryGrid profileId={profile?.id} />
            }

            <article className="content-card">
              <h2>What you can do here</h2>
              <ul className="feature-list">
                {highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </>
        )}

        <article className="content-card">
          <h2>Quick links</h2>
          <ul className="feature-list">
            {isTaDashboard && (
              <>
                <li>
                  <Link to="/curriculum/courses" className="text-link">
                    Review assigned course details
                  </Link>
                </li>
                <li>
                  <Link to="/curriculum/assignments" className="text-link">
                    Check assignment workload
                  </Link>
                </li>
                <li>
                  <Link to="/curriculum/materials" className="text-link">
                    Open teaching materials
                  </Link>
                </li>
              </>
            )}
            <li>
              <Link to="/announcements" className="text-link">
                View university announcements
              </Link>
            </li>
            <MaintenanceReportButton submitterId={profile?.id} />
          </ul>
        </article>
      </section>
    </AppShell>
  );
}
