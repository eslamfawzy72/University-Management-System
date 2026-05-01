import { useState, useEffect, useCallback, useRef } from "react";
import AppShell from "../../components/layout/AppShell";
import { BtnPrimary, BtnGhost } from "../../components/ui/Buttons";
import { useRole } from "../../hooks/useRole";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";

function statusChipClass(status) {
  switch (status) {
    case "approved": return "chip chip-green";
    case "rejected": return "chip chip-red";
    default: return "chip chip-gold";
  }
}

function statusLabel(status) {
  if (!status || status === "pending") return "Pending";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const STATUS_FILTERS = [
  { value: "all",      label: "All" },
  { value: "pending",  label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

// ─── Admin view ───────────────────────────────────────────────────────────────

function AdminAdmissionsView() {
  const { profile } = useAuth();

  const [applications, setApplications] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [filter, setFilter]             = useState("all");

  // Review modal state
  const [reviewApp, setReviewApp] = useState(null);
  const [decision, setDecision]   = useState("");
  const [deciding, setDeciding]   = useState(false);
  const [decisionError, setDecisionError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("admission_applications")
      .select("*, applicant:profiles!applicant_id(full_name, email)")
      .order("submitted_at", { ascending: false });
    if (err) setError(err.message);
    else setApplications(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derived: counts per status
  const counts = {
    all:      applications.length,
    pending:  applications.filter((a) => a.status === "pending").length,
    approved: applications.filter((a) => a.status === "approved").length,
    rejected: applications.filter((a) => a.status === "rejected").length,
  };

  const filtered = filter === "all"
    ? applications
    : applications.filter((a) => a.status === filter);

  function openReview(app) {
    setReviewApp(app);
    // Pre-fill if already decided so the admin can revise
    setDecision(app.status !== "pending" ? app.status : "");
    setDecisionError("");
  }

  function closeReview() {
    setReviewApp(null);
    setDecision("");
    setDecisionError("");
  }

  async function handleConfirm() {
    if (!decision) {
      setDecisionError("Please select Approve or Reject before confirming.");
      return;
    }
    setDeciding(true);
    const { error: err } = await supabase
      .from("admission_applications")
      .update({ status: decision, reviewed_by: profile.id })
      .eq("id", reviewApp.id);
    setDeciding(false);
    if (err) { setDecisionError(err.message); return; }
    closeReview();
    load();
  }

  return (
    <AppShell title="Admission Applications">
      <div className="dashboard-stack">
        {loading && <p className="text-muted">Loading applications…</p>}
        {error   && <p className="error-msg">{error}</p>}

        {!loading && !error && (
          <div className="content-card">
            {/* ── Filter tabs ── */}
            <h2>All Applications</h2>
            <div className="course-tabs" style={{ marginTop: 14 }}>
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  className={`course-tab${filter === f.value ? " course-tab--active" : ""}`}
                  onClick={() => setFilter(f.value)}
                >
                  {f.label}
                  <span className="admission-filter-count">{counts[f.value]}</span>
                </button>
              ))}
            </div>

            {/* ── Table ── */}
            {filtered.length === 0 ? (
              <p className="empty-state">
                {filter === "all"
                  ? "No applications submitted yet."
                  : `No ${filter} applications.`}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Applicant</th>
                      <th>Email</th>
                      <th>Submitted</th>
                      <th>Status</th>
                      <th>Documents</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((app) => (
                      <tr key={app.id}>
                        <td className="col-name">{app.applicant?.full_name || "—"}</td>
                        <td>{app.applicant?.email || "—"}</td>
                        <td>
                          {app.submitted_at
                            ? new Date(app.submitted_at).toLocaleDateString()
                            : "—"}
                        </td>
                        <td>
                          <span className={statusChipClass(app.status)}>
                            {statusLabel(app.status)}
                          </span>
                        </td>
                        <td>
                          {app.documents_url
                            ? (
                              <a href={app.documents_url} target="_blank" rel="noopener noreferrer">
                                <BtnGhost className="btn-xs">View</BtnGhost>
                              </a>
                            )
                            : "—"}
                        </td>
                        <td>
                          <BtnGhost className="btn-xs" onClick={() => openReview(app)}>
                            Review
                          </BtnGhost>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Review modal ── */}
      {reviewApp && (
        <div className="modal-overlay" onClick={closeReview}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">Review Application</h2>

            {/* Applicant details */}
            <div className="admission-status-grid" style={{ marginTop: 16 }}>
              <div className="admission-status-item">
                <p className="eyebrow">Applicant</p>
                <p className="admission-status-value">{reviewApp.applicant?.full_name || "—"}</p>
              </div>
              <div className="admission-status-item">
                <p className="eyebrow">Email</p>
                <p className="admission-status-value">{reviewApp.applicant?.email || "—"}</p>
              </div>
              <div className="admission-status-item">
                <p className="eyebrow">Submitted</p>
                <p className="admission-status-value">
                  {reviewApp.submitted_at
                    ? new Date(reviewApp.submitted_at).toLocaleDateString()
                    : "—"}
                </p>
              </div>
              <div className="admission-status-item">
                <p className="eyebrow">Current status</p>
                <span className={statusChipClass(reviewApp.status)}>
                  {statusLabel(reviewApp.status)}
                </span>
              </div>
              {reviewApp.documents_url && (
                <div className="admission-status-item">
                  <p className="eyebrow">Documents</p>
                  <a
                    href={reviewApp.documents_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link"
                  >
                    View file →
                  </a>
                </div>
              )}
            </div>

            {/* Decision selector */}
            <div className="field" style={{ marginTop: 24 }}>
              <span>
                Decision <span className="text-danger" aria-hidden="true">*</span>
              </span>
              <div className="decision-options">
                <label
                  className={`decision-option decision-option--approve${decision === "approved" ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="decision"
                    value="approved"
                    checked={decision === "approved"}
                    onChange={() => { setDecision("approved"); setDecisionError(""); }}
                  />
                  <span className="chip chip-green">Approve</span>
                </label>

                <label
                  className={`decision-option decision-option--reject${decision === "rejected" ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="decision"
                    value="rejected"
                    checked={decision === "rejected"}
                    onChange={() => { setDecision("rejected"); setDecisionError(""); }}
                  />
                  <span className="chip chip-red">Reject</span>
                </label>
              </div>
              {decisionError
                ? <small className="text-danger">{decisionError}</small>
                : <small style={{ color: "var(--text-muted)" }}>A decision is required before confirming.</small>
              }
            </div>

            <div className="modal-actions">
              <BtnGhost onClick={closeReview}>Cancel</BtnGhost>
              <BtnPrimary disabled={deciding} onClick={handleConfirm}>
                {deciding ? "Saving…" : "Confirm Decision"}
              </BtnPrimary>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// ─── Student view ─────────────────────────────────────────────────────────────

export default function AdmissionsPage() {
  const { is } = useRole();
  const { profile } = useAuth();
  const isAdmin = is("admin");

  const [myApplication, setMyApplication] = useState(null);
  const [appLoading, setAppLoading]       = useState(true);
  const [docFile, setDocFile]             = useState(null);
  const [docError, setDocError]           = useState("");
  const [submitError, setSubmitError]     = useState(null);
  const [submitting, setSubmitting]       = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (isAdmin || !profile?.id) { setAppLoading(false); return; }
    supabase
      .from("admission_applications")
      .select("*")
      .eq("applicant_id", profile.id)
      .maybeSingle()
      .then(({ data }) => {
        setMyApplication(data ?? null);
        setAppLoading(false);
      });
  }, [profile?.id, isAdmin]);

  if (isAdmin) return <AdminAdmissionsView />;

  function validate() {
    if (!docFile) { setDocError("Please select a document to upload."); return false; }
    setDocError("");
    return true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setSubmitError(null);

    const filePath = `${profile.id}/${Date.now()}-${docFile.name}`;
    const { data: stored, error: storeErr } = await supabase.storage
      .from("admission-docs")
      .upload(filePath, docFile);

    if (storeErr) { setSubmitError(storeErr.message); setSubmitting(false); return; }

    const { data: { publicUrl } } = supabase.storage
      .from("admission-docs")
      .getPublicUrl(stored.path);

    const { error: insertErr } = await supabase
      .from("admission_applications")
      .insert({
        applicant_id: profile.id,
        status: "pending",
        documents_url: publicUrl,
        submitted_at: new Date().toISOString(),
      });

    if (insertErr) {
      setSubmitError(
        insertErr.code === "23505" || insertErr.message.toLowerCase().includes("duplicate")
          ? "You have already submitted an application."
          : insertErr.message
      );
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setJustSubmitted(true);

    const { data } = await supabase
      .from("admission_applications")
      .select("*")
      .eq("applicant_id", profile.id)
      .maybeSingle();
    setMyApplication(data ?? null);
  }

  return (
    <AppShell title="Admission Application">
      <div className="dashboard-stack">
        {appLoading && <p className="text-muted">Loading…</p>}

        {!appLoading && myApplication && (
          <div className="content-card">
            <h2>Your Application</h2>
            {justSubmitted && (
              <div className="form-banner admission-banner">
                Your application was submitted successfully. We will review it and get back to you.
              </div>
            )}
            <div className="admission-status-grid">
              <div className="admission-status-item">
                <p className="eyebrow">Status</p>
                <span className={statusChipClass(myApplication.status)}>
                  {statusLabel(myApplication.status)}
                </span>
              </div>
              <div className="admission-status-item">
                <p className="eyebrow">Submitted</p>
                <p className="admission-status-value">
                  {myApplication.submitted_at
                    ? new Date(myApplication.submitted_at).toLocaleDateString()
                    : "—"}
                </p>
              </div>
              {myApplication.documents_url && (
                <div className="admission-status-item">
                  <p className="eyebrow">Documents</p>
                  <a
                    href={myApplication.documents_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link"
                  >
                    View uploaded file
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {!appLoading && !myApplication && (
          <div className="content-card">
            <h2>Apply to the University</h2>
            <p className="text-muted" style={{ marginTop: 6 }}>
              Fill in the form and attach your supporting documents to submit your application.
            </p>

            {submitError && <p className="error-msg">{submitError}</p>}

            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="form-row-2">
                <div className="field">
                  <span>Full Name</span>
                  <input value={profile?.full_name || ""} readOnly className="admission-readonly" />
                </div>
                <div className="field">
                  <span>Email Address</span>
                  <input value={profile?.email || ""} readOnly className="admission-readonly" />
                </div>
              </div>

              <div className="field">
                <span>
                  Supporting Documents{" "}
                  <span className="text-danger" aria-hidden="true">*</span>
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  className="file-input"
                  onChange={(e) => {
                    setDocFile(e.target.files[0] || null);
                    if (e.target.files[0]) setDocError("");
                  }}
                />
                {docError
                  ? <small>{docError}</small>
                  : <small style={{ color: "var(--text-muted)" }}>Accepted: PDF, images, Word documents</small>
                }
              </div>

              <div>
                <BtnPrimary type="submit" disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit Application"}
                </BtnPrimary>
              </div>
            </form>
          </div>
        )}
      </div>
    </AppShell>
  );
}
