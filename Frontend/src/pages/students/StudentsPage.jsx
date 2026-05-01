import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import AppShell from "../../components/layout/AppShell";
import { BtnPrimary, BtnGhost } from "../../components/ui/Buttons";
import { useAuth } from "../../hooks/useAuth";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../../lib/supabase";
import { roleChipClass, roleLabel } from "../../lib/roles";

function generateTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const random = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `Uni@${random}`;
}

function makeTempClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// ─── Student constants ────────────────────────────────────────────────────────

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

// ─── Staff constants ──────────────────────────────────────────────────────────

const STAFF_FILTERS = [
  { value: "all",       label: "All" },
  { value: "ta",        label: "TA" },
  { value: "professor", label: "Professor" },
  { value: "admin",     label: "Admin" },
  { value: "removed",   label: "Removed" },
];

const STAFF_ROLE_OPTIONS = [
  { value: "ta",        label: "Teaching Assistant (TA)" },
  { value: "professor", label: "Professor" },
  { value: "admin",     label: "Admin" },
];

function nextPromotionRole(role) {
  if (role === "ta")        return "professor";
  if (role === "professor") return "admin";
  return null;
}

const EMPTY_STAFF_FORM = { fullName: "", email: "", role: "ta" };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StudentsPage() {
  const { profile } = useAuth();

  const [activeTab, setActiveTab] = useState("students");

  // ── Student state ──────────────────────────────────────────────────────────
  const [students,    setStudents]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [filter,      setFilter]      = useState("all");

  const [showAdd,     setShowAdd]     = useState(false);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [formErrors,  setFormErrors]  = useState({});
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [tempPassword,setTempPassword]= useState("");

  const [actionTarget,setActionTarget]= useState(null);
  const [actioning,   setActioning]   = useState(false);

  // ── Staff state ────────────────────────────────────────────────────────────
  const [staff,           setStaff]           = useState([]);
  const [staffLoading,    setStaffLoading]    = useState(true);
  const [staffError,      setStaffError]      = useState(null);
  const [staffFilter,     setStaffFilter]     = useState("all");

  const [showAddStaff,    setShowAddStaff]    = useState(false);
  const [staffForm,       setStaffForm]       = useState(EMPTY_STAFF_FORM);
  const [staffFormErrors, setStaffFormErrors] = useState({});
  const [staffSubmitting, setStaffSubmitting] = useState(false);
  const [staffSubmitError,setStaffSubmitError]= useState("");
  const [staffTempPwd,    setStaffTempPwd]    = useState("");

  const [staffActionTarget,setStaffActionTarget]= useState(null);
  const [staffActioning,   setStaffActioning]   = useState(false);

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadStudents = useCallback(async () => {
    setLoading(true); setError(null);
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

  const loadStaff = useCallback(async () => {
    setStaffLoading(true); setStaffError(null);
    const { data, error: err } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, is_removed")
      .in("role", ["ta", "professor", "admin"])
      .order("full_name");
    if (err) setStaffError(err.message);
    else setStaff(data || []);
    setStaffLoading(false);
  }, []);

  useEffect(() => { loadStudents(); loadStaff(); }, [loadStudents, loadStaff]);

  // ── Student derived data ──────────────────────────────────────────────────

  const activeStudents = students.filter((s) => !s.is_removed);
  const studentCounts = {
    all:      activeStudents.length,
    approved: activeStudents.filter((s) => getApp(s)?.status === "approved").length,
    pending:  activeStudents.filter((s) => getApp(s)?.status === "pending").length,
    rejected: activeStudents.filter((s) => getApp(s)?.status === "rejected").length,
    none:     activeStudents.filter((s) => !getApp(s)).length,
    removed:  students.filter((s) => s.is_removed).length,
  };

  const filteredStudents = filter === "removed"
    ? students.filter((s) => s.is_removed)
    : filter === "all"
      ? activeStudents
      : filter === "none"
        ? activeStudents.filter((s) => !getApp(s))
        : activeStudents.filter((s) => getApp(s)?.status === filter);

  // ── Staff derived data ────────────────────────────────────────────────────

  const activeStaff = staff.filter((s) => !s.is_removed);
  const staffCounts = {
    all:       activeStaff.length,
    ta:        activeStaff.filter((s) => s.role === "ta").length,
    professor: activeStaff.filter((s) => s.role === "professor").length,
    admin:     activeStaff.filter((s) => s.role === "admin").length,
    removed:   staff.filter((s) => s.is_removed).length,
  };

  const filteredStaff = staffFilter === "removed"
    ? staff.filter((s) => s.is_removed)
    : staffFilter === "all"
      ? activeStaff
      : activeStaff.filter((s) => s.role === staffFilter);

  // ── Student form handlers ─────────────────────────────────────────────────

  function field(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
    setFormErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validateAdd() {
    const errs = {};
    if (!form.fullName.trim())      errs.fullName      = "Full name is required.";
    if (!form.email.trim())         errs.email         = "Email is required.";
    if (!form.studentNumber.trim()) errs.studentNumber = "Student number is required.";
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleAdd() {
    if (!validateAdd()) return;
    setSubmitting(true); setSubmitError("");

    const email = form.email.trim().toLowerCase();

    const { data: dupNum } = await supabase
      .from("profiles").select("id").eq("student_number", form.studentNumber.trim()).maybeSingle();
    if (dupNum) { setSubmitError("A student with this student number already exists."); setSubmitting(false); return; }

    const { data: dupEmail } = await supabase
      .from("profiles").select("id").eq("email", email).maybeSingle();
    if (dupEmail) { setSubmitError("An account with this email already exists."); setSubmitting(false); return; }

    const tmp = makeTempClient();
    const pwd = generateTempPassword();
    const { data: authData, error: authErr } = await tmp.auth.signUp({ email, password: pwd });
    if (authErr) { setSubmitError(authErr.message); setSubmitting(false); return; }

    const newUserId = authData.user?.id;
    if (!newUserId) {
      setSubmitError("Account creation failed — check that email confirmation is disabled in Supabase Auth settings.");
      setSubmitting(false); return;
    }

    const { error: profileErr } = await supabase.from("profiles").upsert({
      id: newUserId, email,
      full_name:      form.fullName.trim(),
      role:           "student",
      student_number: form.studentNumber.trim(),
      must_change_password: true,
    }, { onConflict: "id" });
    if (profileErr) { setSubmitError(profileErr.message); setSubmitting(false); return; }

    const { error: appErr } = await supabase.from("admission_applications").insert({
      applicant_id: newUserId,
      status:       "approved",
      submitted_at: new Date().toISOString(),
      reviewed_by:  profile.id,
    });
    if (appErr) { setSubmitError(appErr.message); setSubmitting(false); return; }

    setSubmitting(false);
    setTempPassword(pwd);
    loadStudents();
  }

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
        .update({ status: "approved", reviewed_by: profile.id }).eq("id", app.id);
    } else if (action === "reject" && app) {
      await supabase.from("admission_applications")
        .update({ status: "rejected", reviewed_by: profile.id }).eq("id", app.id);
    }

    setActioning(false); setActionTarget(null); loadStudents();
  }

  // ── Staff form handlers ───────────────────────────────────────────────────

  function sField(key, val) {
    setStaffForm((f) => ({ ...f, [key]: val }));
    setStaffFormErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validateStaffAdd() {
    const errs = {};
    if (!staffForm.fullName.trim()) errs.fullName = "Full name is required.";
    if (!staffForm.email.trim())    errs.email    = "Email is required.";
    setStaffFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleAddStaff() {
    if (!validateStaffAdd()) return;
    setStaffSubmitting(true); setStaffSubmitError("");

    const email = staffForm.email.trim().toLowerCase();

    const { data: dupEmail } = await supabase
      .from("profiles").select("id").eq("email", email).maybeSingle();
    if (dupEmail) { setStaffSubmitError("An account with this email already exists."); setStaffSubmitting(false); return; }

    const tmp = makeTempClient();
    const pwd = generateTempPassword();
    const { data: authData, error: authErr } = await tmp.auth.signUp({ email, password: pwd });
    if (authErr) { setStaffSubmitError(authErr.message); setStaffSubmitting(false); return; }

    const newUserId = authData.user?.id;
    if (!newUserId) {
      setStaffSubmitError("Account creation failed — check that email confirmation is disabled in Supabase Auth settings.");
      setStaffSubmitting(false); return;
    }

    const { error: profileErr } = await supabase.from("profiles").upsert({
      id: newUserId, email,
      full_name:            staffForm.fullName.trim(),
      role:                 staffForm.role,
      must_change_password: true,
    }, { onConflict: "id" });
    if (profileErr) { setStaffSubmitError(profileErr.message); setStaffSubmitting(false); return; }

    setStaffSubmitting(false);
    setStaffTempPwd(pwd);
    loadStaff();
  }

  async function handleStaffAction() {
    if (!staffActionTarget) return;
    const { person, action } = staffActionTarget;
    setStaffActioning(true);

    if (action === "remove") {
      await supabase.from("profiles").update({ is_removed: true }).eq("id", person.id);
    } else if (action === "restore") {
      await supabase.from("profiles").update({ is_removed: false }).eq("id", person.id);
    } else if (action === "promote") {
      const next = nextPromotionRole(person.role);
      if (next) await supabase.from("profiles").update({ role: next }).eq("id", person.id);
    }

    setStaffActioning(false); setStaffActionTarget(null); loadStaff();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function openAddStudent() {
    setShowAdd(true); setForm(EMPTY_FORM); setFormErrors({}); setSubmitError(""); setTempPassword("");
  }

  function openAddStaff() {
    setShowAddStaff(true); setStaffForm(EMPTY_STAFF_FORM); setStaffFormErrors({}); setStaffSubmitError(""); setStaffTempPwd("");
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell title="People">
      <div className="dashboard-stack">

        {/* ── Top-level tab switcher ── */}
        <div className="course-tabs">
          <button
            className={`course-tab${activeTab === "students" ? " course-tab--active" : ""}`}
            onClick={() => setActiveTab("students")}
          >
            Students
          </button>
          <button
            className={`course-tab${activeTab === "staff" ? " course-tab--active" : ""}`}
            onClick={() => setActiveTab("staff")}
          >
            Staff
          </button>
        </div>

        {/* ════════════════════════════ STUDENTS PANEL ═════════════════════════ */}
        {activeTab === "students" && (
          <>
            {loading && <p className="text-muted">Loading students…</p>}
            {error   && <p className="error-msg">{error}</p>}

            {!loading && !error && (
              <div className="content-card">
                <div className="students-header">
                  <h2>All Students</h2>
                  <BtnPrimary onClick={openAddStudent}>+ Add Student</BtnPrimary>
                </div>

                <div className="course-tabs" style={{ marginTop: 14 }}>
                  {STATUS_FILTERS.map((f) => (
                    <button
                      key={f.value}
                      className={`course-tab${filter === f.value ? " course-tab--active" : ""}`}
                      onClick={() => setFilter(f.value)}
                    >
                      {f.label}
                      <span className="admission-filter-count">{studentCounts[f.value]}</span>
                    </button>
                  ))}
                </div>

                {filteredStudents.length === 0 ? (
                  <p className="empty-state">
                    {filter === "all"
                      ? "No students in the system yet."
                      : filter === "none"
                        ? "All students have an admission application."
                        : filter === "removed"
                          ? "No removed students."
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
                        {filteredStudents.map((student) => {
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
                                  ? <a href={app.documents_url} target="_blank" rel="noopener noreferrer" className="text-link">View</a>
                                  : <span className="text-muted" style={{ fontSize: 13 }}>Not uploaded</span>}
                              </td>
                              <td className="actions-cell">
                                {student.is_removed ? (
                                  <BtnPrimary className="btn-xs"
                                    onClick={() => setActionTarget({ student, action: "restore" })}>
                                    Restore
                                  </BtnPrimary>
                                ) : (
                                  <>
                                    {app?.status === "pending" && (
                                      <BtnPrimary className="btn-xs"
                                        onClick={() => setActionTarget({ student, action: "accept" })}>
                                        Accept
                                      </BtnPrimary>
                                    )}
                                    {app?.status === "pending" && (
                                      <BtnGhost className="btn-xs btn-ghost-danger"
                                        onClick={() => setActionTarget({ student, action: "reject" })}>
                                        Reject
                                      </BtnGhost>
                                    )}
                                    <BtnGhost className="btn-xs btn-ghost-danger"
                                      onClick={() => setActionTarget({ student, action: "remove" })}>
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
          </>
        )}

        {/* ════════════════════════════ STAFF PANEL ════════════════════════════ */}
        {activeTab === "staff" && (
          <>
            {staffLoading && <p className="text-muted">Loading staff…</p>}
            {staffError   && <p className="error-msg">{staffError}</p>}

            {!staffLoading && !staffError && (
              <div className="content-card">
                <div className="students-header">
                  <h2>All Staff</h2>
                  <BtnPrimary onClick={openAddStaff}>+ Add Staff</BtnPrimary>
                </div>

                <div className="course-tabs" style={{ marginTop: 14 }}>
                  {STAFF_FILTERS.map((f) => (
                    <button
                      key={f.value}
                      className={`course-tab${staffFilter === f.value ? " course-tab--active" : ""}`}
                      onClick={() => setStaffFilter(f.value)}
                    >
                      {f.label}
                      <span className="admission-filter-count">{staffCounts[f.value]}</span>
                    </button>
                  ))}
                </div>

                {filteredStaff.length === 0 ? (
                  <p className="empty-state">
                    {staffFilter === "all"
                      ? "No staff members yet."
                      : staffFilter === "removed"
                        ? "No removed staff members."
                        : `No ${staffFilter} staff members.`}
                  </p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStaff.map((person) => {
                          const promote = person.is_removed ? null : nextPromotionRole(person.role);
                          return (
                            <tr key={person.id}>
                              <td className="col-name">{person.full_name || "—"}</td>
                              <td>{person.email || "—"}</td>
                              <td>
                                {person.is_removed
                                  ? <span className="chip chip-gray">Removed</span>
                                  : <span className={`chip ${roleChipClass(person.role)}`}>{roleLabel(person.role)}</span>}
                              </td>
                              <td className="actions-cell">
                                {person.is_removed ? (
                                  <BtnPrimary className="btn-xs"
                                    onClick={() => setStaffActionTarget({ person, action: "restore" })}>
                                    Restore
                                  </BtnPrimary>
                                ) : (
                                  <>
                                    {promote && (
                                      <BtnPrimary className="btn-xs"
                                        onClick={() => setStaffActionTarget({ person, action: "promote" })}>
                                        → {roleLabel(promote)}
                                      </BtnPrimary>
                                    )}
                                    <BtnGhost className="btn-xs btn-ghost-danger"
                                      onClick={() => setStaffActionTarget({ person, action: "remove" })}>
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
          </>
        )}
      </div>

      {/* ════════════════ ADD STUDENT MODAL ════════════════ */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => { if (!tempPassword) setShowAdd(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {tempPassword ? (
              <>
                <h2 className="modal__title">Account Created</h2>
                <p className="modal__body">
                  A confirmation email has been sent to <strong>{form.email}</strong>.
                  The student must click the link before they can log in.
                </p>
                <div className="temp-password-box">
                  <span className="temp-password-box__label">Temporary password (share with student)</span>
                  <div className="temp-password-box__row">
                    <code className="temp-password-box__code">{tempPassword}</code>
                    <BtnGhost className="btn-xs" onClick={() => navigator.clipboard?.writeText(tempPassword)}>Copy</BtnGhost>
                  </div>
                  <small style={{ color: "var(--text-muted)" }}>
                    The student uses this password after confirming their email. Shown only once.
                  </small>
                </div>
                <div className="modal-actions">
                  <BtnPrimary onClick={() => { setShowAdd(false); setTempPassword(""); setForm(EMPTY_FORM); }}>Done</BtnPrimary>
                </div>
              </>
            ) : (
              <>
                <h2 className="modal__title">Add Student</h2>
                {submitError && <p className="error-msg">{submitError}</p>}
                <div className="auth-form">
                  <div className="field">
                    <span>Full Name <span className="text-danger">*</span></span>
                    <input placeholder="e.g. Ahmed Mohamed" value={form.fullName}
                      className={formErrors.fullName ? "has-error" : ""}
                      onChange={(e) => field("fullName", e.target.value)} />
                    {formErrors.fullName && <small>{formErrors.fullName}</small>}
                  </div>
                  <div className="field">
                    <span>Email <span className="text-danger">*</span></span>
                    <input type="email" placeholder="student@university.edu" value={form.email}
                      className={formErrors.email ? "has-error" : ""}
                      onChange={(e) => field("email", e.target.value)} />
                    {formErrors.email
                      ? <small>{formErrors.email}</small>
                      : <small style={{ color: "var(--text-muted)" }}>A new account will be created for this email.</small>}
                  </div>
                  <div className="field">
                    <span>Student Number <span className="text-danger">*</span></span>
                    <input placeholder="e.g. 20210001" value={form.studentNumber}
                      className={formErrors.studentNumber ? "has-error" : ""}
                      onChange={(e) => field("studentNumber", e.target.value)} />
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

      {/* ════════════════ STUDENT ACTION MODAL ════════════════ */}
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
                ? `Approve the admission for ${actionTarget.student.full_name}? They will gain full access to the system.`
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

      {/* ════════════════ ADD STAFF MODAL ════════════════ */}
      {showAddStaff && (
        <div className="modal-overlay" onClick={() => { if (!staffTempPwd) setShowAddStaff(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {staffTempPwd ? (
              <>
                <h2 className="modal__title">Account Created</h2>
                <p className="modal__body">
                  A confirmation email has been sent to <strong>{staffForm.email}</strong>.
                  The staff member must click the link before they can log in.
                </p>
                <div className="temp-password-box">
                  <span className="temp-password-box__label">Temporary password (share with staff member)</span>
                  <div className="temp-password-box__row">
                    <code className="temp-password-box__code">{staffTempPwd}</code>
                    <BtnGhost className="btn-xs" onClick={() => navigator.clipboard?.writeText(staffTempPwd)}>Copy</BtnGhost>
                  </div>
                  <small style={{ color: "var(--text-muted)" }}>Shown only once — save it before closing.</small>
                </div>
                <div className="modal-actions">
                  <BtnPrimary onClick={() => { setShowAddStaff(false); setStaffTempPwd(""); setStaffForm(EMPTY_STAFF_FORM); }}>Done</BtnPrimary>
                </div>
              </>
            ) : (
              <>
                <h2 className="modal__title">Add Staff Member</h2>
                {staffSubmitError && <p className="error-msg">{staffSubmitError}</p>}
                <div className="auth-form">
                  <div className="field">
                    <span>Full Name <span className="text-danger">*</span></span>
                    <input placeholder="e.g. Dr. Ahmed Mohamed" value={staffForm.fullName}
                      className={staffFormErrors.fullName ? "has-error" : ""}
                      onChange={(e) => sField("fullName", e.target.value)} />
                    {staffFormErrors.fullName && <small>{staffFormErrors.fullName}</small>}
                  </div>
                  <div className="field">
                    <span>Email <span className="text-danger">*</span></span>
                    <input type="email" placeholder="staff@university.edu" value={staffForm.email}
                      className={staffFormErrors.email ? "has-error" : ""}
                      onChange={(e) => sField("email", e.target.value)} />
                    {staffFormErrors.email
                      ? <small>{staffFormErrors.email}</small>
                      : <small style={{ color: "var(--text-muted)" }}>A new account will be created for this email.</small>}
                  </div>
                  <div className="field">
                    <span>Role <span className="text-danger">*</span></span>
                    <select value={staffForm.role} onChange={(e) => sField("role", e.target.value)}>
                      {STAFF_ROLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="modal-actions">
                  <BtnGhost onClick={() => setShowAddStaff(false)}>Cancel</BtnGhost>
                  <BtnPrimary disabled={staffSubmitting} onClick={handleAddStaff}>
                    {staffSubmitting ? "Creating…" : "Create Account"}
                  </BtnPrimary>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ════════════════ STAFF ACTION MODAL ════════════════ */}
      {staffActionTarget && (
        <div className="modal-overlay" onClick={() => setStaffActionTarget(null)}>
          <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">
              {staffActionTarget.action === "restore" ? "Restore Staff Member?" :
               staffActionTarget.action === "promote"
                 ? `Promote to ${roleLabel(nextPromotionRole(staffActionTarget.person.role))}?`
                 : "Remove Staff Member?"}
            </h2>
            <p className="modal__body">
              {staffActionTarget.action === "restore"
                ? `Restore ${staffActionTarget.person.full_name}'s account? They will be able to log in again.`
                : staffActionTarget.action === "promote"
                  ? `Promote ${staffActionTarget.person.full_name} from ${roleLabel(staffActionTarget.person.role)} to ${roleLabel(nextPromotionRole(staffActionTarget.person.role))}? This changes their system access level.`
                  : `Remove ${staffActionTarget.person.full_name}? They will be unable to log in until restored.`}
            </p>
            <div className="modal-actions">
              <BtnGhost onClick={() => setStaffActionTarget(null)}>Cancel</BtnGhost>
              <BtnPrimary
                className={staffActionTarget.action === "remove" ? "btn-danger" : ""}
                disabled={staffActioning}
                onClick={handleStaffAction}
              >
                {staffActioning ? "Processing…" :
                  staffActionTarget.action === "restore" ? "Restore" :
                  staffActionTarget.action === "promote" ? "Promote" : "Remove"}
              </BtnPrimary>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
