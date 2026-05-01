import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import AppShell from "../../components/layout/AppShell";
import { BtnPrimary, BtnGhost } from "../../components/ui/Buttons";
import { useAuth } from "../../hooks/useAuth";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../../lib/supabase";

function generateTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const random = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `Uni@${random}`;
}

// Secondary client — persistSession:false keeps admin's session untouched
function makeTempClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { value: "all",      label: "All" },
  { value: "approved", label: "Approved" },
  { value: "pending",  label: "Pending" },
  { value: "rejected", label: "Rejected" },
  { value: "none",     label: "No Application" },
  { value: "removed",  label: "Removed" },
];

function getApp(student) {
  const apps = student.admission_applications;
  if (!apps || apps.length === 0) return null;
  return [...apps].sort(
    (a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0)
  )[0];
}

function statusChipClass(status) {
  switch (status) {
    case "approved": return "chip chip-green";
    case "rejected": return "chip chip-red";
    case "pending":  return "chip chip-gold";
    default:         return "chip chip-gray";
  }
}

function statusLabel(status) {
  if (!status) return "No Application";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const EMPTY_FORM = { fullName: "", email: "", studentNumber: "" };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StudentsPage() {
  const { profile } = useAuth();

  const [students,     setStudents]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [filter,       setFilter]       = useState("all");

  // Add modal
  const [showAdd,      setShowAdd]      = useState(false);
  const [form,         setForm]         = useState(EMPTY_FORM);
  const [formErrors,   setFormErrors]   = useState({});
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState("");
  const [tempPassword, setTempPassword] = useState(""); // shown after creation

  // Action confirm modal  { student, action: "accept" | "reject" | "remove" }
  const [actionTarget, setActionTarget] = useState(null);
  const [actioning,    setActioning]    = useState(false);

  // ── Data ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("profiles")
      .select(`
        id, full_name, email, student_number, is_removed,
        admission_applications!applicant_id(id, status, documents_url, submitted_at)
      `)
      .eq("role", "student")
      .order("full_name");
    if (err) setError(err.message);
    else setStudents(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Filter counts ────────────────────────────────────────────────────────────

  const active = students.filter((s) => !s.is_removed);

  const counts = {
    all:      active.length,
    approved: active.filter((s) => getApp(s)?.status === "approved").length,
    pending:  active.filter((s) => getApp(s)?.status === "pending").length,
    rejected: active.filter((s) => getApp(s)?.status === "rejected").length,
    none:     active.filter((s) => !getApp(s)).length,
    removed:  students.filter((s) => s.is_removed).length,
  };

  const filtered = filter === "removed"
    ? students.filter((s) => s.is_removed)
    : filter === "all"
      ? active
      : filter === "none"
        ? active.filter((s) => !getApp(s))
        : active.filter((s) => getApp(s)?.status === filter);

  // ── Add student ──────────────────────────────────────────────────────────────

  function field(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
    setFormErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validateAdd() {
    const errs = {};
    if (!form.fullName.trim())       errs.fullName      = "Full name is required.";
    if (!form.email.trim())          errs.email         = "Email is required.";
    if (!form.studentNumber.trim())  errs.studentNumber = "Student number is required.";
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleAdd() {
    if (!validateAdd()) return;
    setSubmitting(true);
    setSubmitError("");

    const email = form.email.trim().toLowerCase();

    // Duplicate student number check
    const { data: dupNum } = await supabase
      .from("profiles")
      .select("id")
      .eq("student_number", form.studentNumber.trim())
      .maybeSingle();
    if (dupNum) {
      setSubmitError("A student with this student number already exists.");
      setSubmitting(false);
      return;
    }

    // Duplicate email check
    const { data: dupEmail } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (dupEmail) {
      setSubmitError("An account with this email already exists.");
      setSubmitting(false);
      return;
    }

    // Create auth user via secondary client (admin session stays untouched)
    const tmp = makeTempClient();
    const pwd = generateTempPassword();
    const { data: authData, error: authErr } = await tmp.auth.signUp({ email, password: pwd });
    if (authErr) { setSubmitError(authErr.message); setSubmitting(false); return; }

    const newUserId = authData.user?.id;
    if (!newUserId) {
      setSubmitError("Account creation failed — check that email confirmation is disabled in Supabase Auth settings.");
      setSubmitting(false);
      return;
    }

    // Upsert profile (handles any auto-trigger from signUp)
    const { error: profileErr } = await supabase.from("profiles").upsert({
      id:                  newUserId,
      email,
      full_name:           form.fullName.trim(),
      role:                "student",
      student_number:      form.studentNumber.trim(),
      must_change_password: true,
    }, { onConflict: "id" });
    if (profileErr) { setSubmitError(profileErr.message); setSubmitting(false); return; }

    // Create auto-approved admission application
    const { error: appErr } = await supabase.from("admission_applications").insert({
      applicant_id: newUserId,
      status:       "approved",
      submitted_at: new Date().toISOString(),
      reviewed_by:  profile.id,
    });
    if (appErr) { setSubmitError(appErr.message); setSubmitting(false); return; }

    setSubmitting(false);
    setTempPassword(pwd);  // switch modal to success/password display state
    load();
  }

  // ── Actions (accept / reject / remove) ───────────────────────────────────────

  async function handleAction() {
    if (!actionTarget) return;
    const { student, action } = actionTarget;
    const app = getApp(student);
    setActioning(true);

    if (action === "remove") {
      await supabase.from("profiles").update({ is_removed: true }).eq("id", student.id);
    } else if (action === "restore") {
      await supabase.from("profiles").update({ is_removed: false }).eq("id", student.id);
    } else if (action === "accept" && app) {
      await supabase.from("admission_applications")
        .update({ status: "approved", reviewed_by: profile.id })
        .eq("id", app.id);
    } else if (action === "reject" && app) {
      await supabase.from("admission_applications")
        .update({ status: "rejected", reviewed_by: profile.id })
        .eq("id", app.id);
    }

    setActioning(false);
    setActionTarget(null);
    load();
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Student Records">
      <div className="dashboard-stack">
        {loading && <p className="text-muted">Loading students…</p>}
        {error   && <p className="error-msg">{error}</p>}

        {!loading && !error && (
          <div className="content-card">
            <div className="students-header">
              <h2>All Students</h2>
              <BtnPrimary onClick={() => {
                setShowAdd(true);
                setForm(EMPTY_FORM);
                setFormErrors({});
                setSubmitError("");
              }}>
                + Add Student
              </BtnPrimary>
            </div>

            {/* Filter tabs */}
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

            {filtered.length === 0 ? (
              <p className="empty-state">
                {filter === "all"
                  ? "No students in the system yet."
                  : filter === "none"
                    ? "All students have an admission application."
                    : `No ${filter} students.`}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Student No.</th>
                      <th>Admission Status</th>
                      <th>Document</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((student) => {
                      const app = getApp(student);
                      return (
                        <tr key={student.id}>
                          <td className="col-name">{student.full_name || "—"}</td>
                          <td>{student.email || "—"}</td>
                          <td>{student.student_number || "—"}</td>
                          <td>
                            <span className={statusChipClass(app?.status)}>
                              {statusLabel(app?.status)}
                            </span>
                          </td>
                          <td>
                            {app?.documents_url
                              ? (
                                <a href={app.documents_url} target="_blank" rel="noopener noreferrer" className="text-link">
                                  View
                                </a>
                              ) : (
                                <span className="text-muted" style={{ fontSize: 13 }}>Not uploaded</span>
                              )}
                          </td>
                          <td className="actions-cell">
                            {student.is_removed ? (
                              <BtnPrimary
                                className="btn-xs"
                                onClick={() => setActionTarget({ student, action: "restore" })}
                              >
                                Restore
                              </BtnPrimary>
                            ) : (
                              <>
                                {app?.status === "pending" && (
                                  <BtnPrimary
                                    className="btn-xs"
                                    onClick={() => setActionTarget({ student, action: "accept" })}
                                  >
                                    Accept
                                  </BtnPrimary>
                                )}
                                {app?.status === "pending" && (
                                  <BtnGhost
                                    className="btn-xs btn-ghost-danger"
                                    onClick={() => setActionTarget({ student, action: "reject" })}
                                  >
                                    Reject
                                  </BtnGhost>
                                )}
                                <BtnGhost
                                  className="btn-xs btn-ghost-danger"
                                  onClick={() => setActionTarget({ student, action: "remove" })}
                                >
                                  Remove
                                </BtnGhost>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Add Student Modal ── */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => { if (!tempPassword) setShowAdd(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>

            {/* ── Step 2: temp password display ── */}
            {tempPassword ? (
              <>
                <h2 className="modal__title">Account Created</h2>
                <p className="modal__body">
                  A confirmation email has been sent to{" "}
                  <strong>{form.email}</strong>. The student must click the link in that
                  email before they can log in.
                </p>
                <div className="temp-password-box">
                  <span className="temp-password-box__label">Temporary password (share with student)</span>
                  <div className="temp-password-box__row">
                    <code className="temp-password-box__code">{tempPassword}</code>
                    <BtnGhost
                      className="btn-xs"
                      onClick={() => navigator.clipboard?.writeText(tempPassword)}
                    >
                      Copy
                    </BtnGhost>
                  </div>
                  <small style={{ color: "var(--text-muted)" }}>
                    The student uses this password after confirming their email. Shown only once — save it before closing.
                  </small>
                </div>
                <div className="modal-actions">
                  <BtnPrimary onClick={() => {
                    setShowAdd(false);
                    setTempPassword("");
                    setForm(EMPTY_FORM);
                  }}>
                    Done
                  </BtnPrimary>
                </div>
              </>
            ) : (
              /* ── Step 1: form ── */
              <>
                <h2 className="modal__title">Add Student</h2>

                {submitError && <p className="error-msg">{submitError}</p>}

                <div className="auth-form">
                  <div className="field">
                    <span>Full Name <span className="text-danger">*</span></span>
                    <input
                      placeholder="e.g. Ahmed Mohamed"
                      value={form.fullName}
                      className={formErrors.fullName ? "has-error" : ""}
                      onChange={(e) => field("fullName", e.target.value)}
                    />
                    {formErrors.fullName && <small>{formErrors.fullName}</small>}
                  </div>

                  <div className="field">
                    <span>Email <span className="text-danger">*</span></span>
                    <input
                      type="email"
                      placeholder="student@university.edu"
                      value={form.email}
                      className={formErrors.email ? "has-error" : ""}
                      onChange={(e) => field("email", e.target.value)}
                    />
                    {formErrors.email
                      ? <small>{formErrors.email}</small>
                      : <small style={{ color: "var(--text-muted)" }}>
                          A new account will be created for this email address.
                        </small>}
                  </div>

                  <div className="field">
                    <span>Student Number <span className="text-danger">*</span></span>
                    <input
                      placeholder="e.g. 20210001"
                      value={form.studentNumber}
                      className={formErrors.studentNumber ? "has-error" : ""}
                      onChange={(e) => field("studentNumber", e.target.value)}
                    />
                    {formErrors.studentNumber && <small>{formErrors.studentNumber}</small>}
                  </div>
                </div>

                <div className="modal-actions">
                  <BtnGhost onClick={() => setShowAdd(false)}>Cancel</BtnGhost>
                  <BtnPrimary disabled={submitting} onClick={handleAdd}>
                    {submitting ? "Creating…" : "Create Account"}
                  </BtnPrimary>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Action Confirm Modal ── */}
      {actionTarget && (
        <div className="modal-overlay" onClick={() => setActionTarget(null)}>
          <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">
              {actionTarget.action === "accept"  ? "Accept Application?" :
               actionTarget.action === "reject"  ? "Reject Application?" :
               actionTarget.action === "restore" ? "Restore Student?" :
               "Remove Student?"}
            </h2>
            <p className="modal__body">
              {actionTarget.action === "accept"
                ? `Approve the admission application for ${actionTarget.student.full_name}? They will gain full access to the system.`
                : actionTarget.action === "reject"
                  ? `Reject the application for ${actionTarget.student.full_name}? They will not be able to access the system.`
                  : actionTarget.action === "restore"
                    ? `Restore ${actionTarget.student.full_name}'s account? They will be able to log in again.`
                    : `Remove ${actionTarget.student.full_name}? They will be unable to log in until restored.`}
            </p>
            <div className="modal-actions">
              <BtnGhost onClick={() => setActionTarget(null)}>Cancel</BtnGhost>
              <BtnPrimary
                className={actionTarget.action === "remove" ? "btn-danger" : ""}
                disabled={actioning}
                onClick={handleAction}
              >
                {actioning ? "Processing…" :
                  actionTarget.action === "accept"  ? "Accept" :
                  actionTarget.action === "reject"  ? "Reject" :
                  actionTarget.action === "restore" ? "Restore" : "Remove"}
              </BtnPrimary>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
