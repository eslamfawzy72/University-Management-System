import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";

import AppShell from "../../components/layout/AppShell";
import { BtnPrimary } from "../../components/ui/Buttons";
import { useAuth } from "../../hooks/useAuth";
import { useEnrollment } from "../../hooks/useEnrollment";
import { roleChipClass, roleLabel } from "../../lib/roles";
import { supabase } from "../../lib/supabase";
import TaAssignedCoursesPanel from "./TaAssignedCoursesPanel";

const DASHBOARD_COPY = {
  student: {
    title: "Student dashboard",
    subtitle: "Track classes, submissions, and grades from one place.",
    summary: [
      { label: "Courses", value: "5" },
      { label: "Pending tasks", value: "3" },
      { label: "Average grade", value: "91%" },
    ],
    highlights: [
      "Enrolled course materials are available for instant reading.",
      "Assignment deadlines stay visible in the dashboard timeline.",
      "Grades and feedback stay tied to your profile row in Supabase.",
    ],
  },
  parent: {
    title: "Parent dashboard",
    subtitle: "Monitor progress and stay in contact with the teaching team.",
    summary: [
      { label: "Linked students", value: "1" },
      { label: "Unread messages", value: "2" },
      { label: "Alerts", value: "1" },
    ],
    highlights: [
      "Check the latest grades for the linked student account.",
      "Follow upcoming assignments and announcements.",
      "Message the teaching team without leaving the portal.",
    ],
  },
  staff: {
    title: "Staff dashboard",
    subtitle: "Manage teaching tasks, materials, and communication.",
    summary: [
      { label: "Active courses", value: "4" },
      { label: "Submissions", value: "18" },
      { label: "Announcements", value: "6" },
    ],
    highlights: [
      "Publish materials and assignments to assigned courses.",
      "Review submissions and record grades for your classes.",
      "Coordinate with students and parents through messages.",
    ],
  },
};

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
          </ul>
        </article>
      </section>
    </AppShell>
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

  const copy = DASHBOARD_COPY[variant];
  const currentRole = profile?.role ?? variant;
  const isTaDashboard = variant === "staff" && currentRole === "ta";
  const title = isTaDashboard ? "TA dashboard" : copy.title;
  const subtitle = isTaDashboard
    ? "Review your assigned courses and current responsibilities."
    : copy.subtitle;

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
            <div className="summary-grid">
              {copy.summary.map((item) => (
                <article key={item.label} className="summary-card">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
            </div>

            <article className="content-card">
              <h2>What you can do here</h2>
              <ul className="feature-list">
                {copy.highlights.map((item) => (
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
          </ul>
        </article>
      </section>
    </AppShell>
  );
}
