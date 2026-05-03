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

const EMPTY_STAFF_FORM = { fullName: "", email: "", role: "ta", office: "", department_id: "" };

// ─── Removal cascades ─────────────────────────────────────────────────────────
//
// Removing a profile is a soft-delete (is_removed=true), but several dependent
// rows must be cleaned up so the system doesn't carry stale assignments:
//
//   Staff removed   → un-assign from courses (course_staff), cancel their
//                     active reservations.
//   Student removed → drop their pending/active enrollments to free the seats.
//                     Academic records (assignment_submissions, assignment_grades)
//                     reference students.id directly and are preserved.
//
// Order matters: lock the profile FIRST so the user can't take any further
// action mid-cascade. If a later step fails, the profile is still locked and
// the admin can retry — repeated runs are no-ops.

async function cascadeRemoveStaff(profileId) {
  const summary = { courseAssignments: 0, reservations: 0 };
  const errors  = [];

  const { error: profileErr } = await supabase
    .from("profiles").update({ is_removed: true }).eq("id", profileId);
  if (profileErr) return { ok: false, summary, errors: [`Account: ${profileErr.message}`] };

  const { data: staffRec } = await supabase
    .from("staff").select("id").eq("profile_id", profileId).maybeSingle();

  if (staffRec?.id) {
    const { data: deleted, error: csErr } = await supabase
      .from("course_staff").delete().eq("staff_id", staffRec.id).select("id");
    if (csErr) errors.push(`Course assignments: ${csErr.message}`);
    else summary.courseAssignments = deleted?.length || 0;
  }

  const { data: cancelled, error: resErr } = await supabase
    .from("reservations").update({ status: "cancelled" })
    .eq("reserved_by", profileId).neq("status", "cancelled").select("id");
  if (resErr) errors.push(`Reservations: ${resErr.message}`);
  else summary.reservations = cancelled?.length || 0;

  return { ok: true, summary, errors };
}

async function cascadeRemoveStudent(profileId) {
  const summary = { enrollments: 0 };
  const errors  = [];

  const { error: profileErr } = await supabase
    .from("profiles").update({ is_removed: true }).eq("id", profileId);
  if (profileErr) return { ok: false, summary, errors: [`Account: ${profileErr.message}`] };

  const { data: studentRec } = await supabase
    .from("students").select("id").eq("profile_id", profileId).maybeSingle();

  if (studentRec?.id) {
    const { data: deleted, error: ceErr } = await supabase
      .from("course_enrollments").delete()
      .eq("student_id", studentRec.id)
      .in("status", ["pending", "enrolled"])
      .select("id");
    if (ceErr) errors.push(`Enrollments: ${ceErr.message}`);
    else summary.enrollments = deleted?.length || 0;
  }

  return { ok: true, summary, errors };
}

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

  const [studentSearch, setStudentSearch] = useState("");
  const [staffSearch,   setStaffSearch]   = useState("");

  const [actionTarget,setActionTarget]= useState(null);
  const [actioning,   setActioning]   = useState(false);
  const [actionResult,setActionResult]= useState(null);   // { summary, errors } | null
  const [actionError, setActionError] = useState("");

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
  const [staffActionResult,setStaffActionResult]= useState(null);   // { summary, errors } | null
  const [staffActionError, setStaffActionError] = useState("");

  const [departments,      setDepartments]      = useState([]);

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

  useEffect(() => {
    loadStudents();
    loadStaff();
    supabase.from("departments").select("id, name").order("name")
      .then(({ data }) => setDepartments(data || []));
  }, [loadStudents, loadStaff]);

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

  const filteredStudentsBase = filter === "removed"
    ? students.filter((s) => s.is_removed)
    : filter === "all"
      ? activeStudents
      : filter === "none"
        ? activeStudents.filter((s) => !getApp(s))
        : activeStudents.filter((s) => getApp(s)?.status === filter);
  const filteredStudents = studentSearch.trim()
    ? filteredStudentsBase.filter((s) => {
        const q = studentSearch.trim().toLowerCase();
        return (s.full_name || "").toLowerCase().includes(q) ||
               (s.email || "").toLowerCase().includes(q);
      })
    : filteredStudentsBase;

  // ── Staff derived data ────────────────────────────────────────────────────

  const activeStaff = staff.filter((s) => !s.is_removed);
  const staffCounts = {
    all:       activeStaff.length,
    ta:        activeStaff.filter((s) => s.role === "ta").length,
    professor: activeStaff.filter((s) => s.role === "professor").length,
    admin:     activeStaff.filter((s) => s.role === "admin").length,
    removed:   staff.filter((s) => s.is_removed).length,
  };

  const filteredStaffBase = staffFilter === "removed"
    ? staff.filter((s) => s.is_removed)
    : staffFilter === "all"
      ? activeStaff
      : activeStaff.filter((s) => s.role === staffFilter);
  const filteredStaff = staffSearch.trim()
    ? filteredStaffBase.filter((s) => {
        const q = staffSearch.trim().toLowerCase();
        return (s.full_name || "").toLowerCase().includes(q) ||
               (s.email || "").toLowerCase().includes(q);
      })
    : filteredStaffBase;

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
    setActionError("");

    if (action === "remove") {
      const result = await cascadeRemoveStudent(student.id);
      setActioning(false);
      if (!result.ok) {
        setActionError(result.errors.join("; "));
        return;
      }
      setActionResult(result);
      loadStudents();
      return;
    }

    if (action === "restore") {
      const { error } = await supabase.from("profiles").update({ is_removed: false }).eq("id", student.id);
      if (error) { setActionError(error.message); setActioning(false); return; }
    } else if (action === "accept" && app) {
      const { error } = await supabase.from("admission_applications")
        .update({ status: "approved", reviewed_by: profile.id }).eq("id", app.id);
      if (error) { setActionError(error.message); setActioning(false); return; }
    } else if (action === "reject" && app) {
      const { error } = await supabase.from("admission_applications")
        .update({ status: "rejected", reviewed_by: profile.id }).eq("id", app.id);
      if (error) { setActionError(error.message); setActioning(false); return; }
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

    // Create the staff row so the person appears in course assignment dropdowns.
    const staffPayload = { profile_id: newUserId };
    if (staffForm.office.trim())      staffPayload.office        = staffForm.office.trim();
    if (staffForm.department_id)      staffPayload.department_id = staffForm.department_id;
    const { error: staffRowErr } = await supabase.from("staff").insert(staffPayload);
    if (staffRowErr) {
      setStaffSubmitError(`Account created but staff record failed: ${staffRowErr.message}`);
      setStaffSubmitting(false);
      return;
    }

    setStaffSubmitting(false);
    setStaffTempPwd(pwd);
    loadStaff();
  }

  async function handleStaffAction() {
    if (!staffActionTarget) return;
    const { person, action } = staffActionTarget;
    setStaffActioning(true);
    setStaffActionError("");

    if (action === "remove") {
      const result = await cascadeRemoveStaff(person.id);
      setStaffActioning(false);
      if (!result.ok) {
        setStaffActionError(result.errors.join("; "));
        return;
      }
      setStaffActionResult(result);
      loadStaff();
      return;
    }

    if (action === "restore") {
      const { error } = await supabase.from("profiles").update({ is_removed: false }).eq("id", person.id);
      if (error) { setStaffActionError(error.message); setStaffActioning(false); return; }
    } else if (action === "promote") {
      const next = nextPromotionRole(person.role);
      if (next) {
        const { error } = await supabase.from("profiles").update({ role: next }).eq("id", person.id);
        if (error) { setStaffActionError(error.message); setStaffActioning(false); return; }

        // Ensure a staff row exists — may be absent for accounts created before the fix.
        const { data: existingStaffRec } = await supabase
          .from("staff").select("id").eq("profile_id", person.id).maybeSingle();
        if (!existingStaffRec) {
          const { error: staffRowErr } = await supabase.from("staff").insert({ profile_id: person.id });
          if (staffRowErr) {
            setStaffActionError(`Promoted, but staff record creation failed: ${staffRowErr.message}`);
            setStaffActioning(false);
            loadStaff();
            return;
          }
        }

        // TA→professor: remove TA course assignments so they can be re-assigned as professor
        if (person.role === "ta") {
          const { data: staffRec } = existingStaffRec
            ? { data: existingStaffRec }
            : await supabase.from("staff").select("id").eq("profile_id", person.id).maybeSingle();
          if (staffRec?.id) {
            const { data: deleted, error: csErr } = await supabase
              .from("course_staff").delete().eq("staff_id", staffRec.id).select("id");
            if (csErr) {
              setStaffActionError(`Promoted, but course de-assignment failed: ${csErr.message}`);
              setStaffActioning(false);
              loadStaff();
              return;
            }
            setStaffActionResult({
              summary: { courseAssignments: deleted?.length || 0, reservations: 0 },
              errors: [],
              kind: "promote",
            });
            setStaffActioning(false);
            loadStaff();
            return;
          }
        }
      }
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

                <input
                  className="search-input"
                  placeholder="Search by name or email…"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  style={{ marginTop: 14, width: "100%", maxWidth: 320 }}
                />

                <div className="course-tabs" style={{ marginTop: 10 }}>
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

                <input
                  className="search-input"
                  placeholder="Search by name or email…"
                  value={staffSearch}
                  onChange={(e) => setStaffSearch(e.target.value)}
                  style={{ marginTop: 14, width: "100%", maxWidth: 320 }}
                />

                <div className="course-tabs" style={{ marginTop: 10 }}>
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
        <div className="modal-overlay" onClick={() => { if (!actioning) { setActionTarget(null); setActionResult(null); setActionError(""); } }}>
          <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
            {actionResult ? (
              <>
                <h2 className="modal__title">Student Removed</h2>
                <p className="modal__body">
                  <strong>{actionTarget.student.full_name}</strong> has been removed.
                </p>
                <ul style={{ margin: "8px 0 12px 18px", fontSize: 14, color: "var(--text)" }}>
                  <li>Account access revoked</li>
                  <li>{actionResult.summary.enrollments} pending/active enrollment{actionResult.summary.enrollments === 1 ? "" : "s"} dropped</li>
                  <li>Submissions and grades preserved</li>
                </ul>
                {actionResult.errors.length > 0 && (
                  <p className="error-msg" style={{ fontSize: 13 }}>
                    Some cleanup failed: {actionResult.errors.join("; ")}
                  </p>
                )}
                <div className="modal-actions">
                  <BtnPrimary onClick={() => { setActionTarget(null); setActionResult(null); }}>Done</BtnPrimary>
                </div>
              </>
            ) : (
              <>
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
                        ? `Restore ${actionTarget.student.full_name}'s account? They will be able to log in again. Previous enrollments are not restored.`
                        : `Remove ${actionTarget.student.full_name}? Their account will be locked, and any pending or active course enrollments will be dropped (freeing the seats). Submissions and grades are preserved. Restoring the account does not restore enrollments.`}
                </p>
                {actionError && <p className="error-msg">{actionError}</p>}
                <div className="modal-actions">
                  <BtnGhost onClick={() => { setActionTarget(null); setActionError(""); }}>Cancel</BtnGhost>
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
              </>
            )}
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
                  <div className="field">
                    <span>Department</span>
                    <select value={staffForm.department_id} onChange={(e) => sField("department_id", e.target.value)}>
                      <option value="">— None —</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <span>Office</span>
                    <input
                      placeholder="e.g. Room 204, Building B"
                      value={staffForm.office}
                      onChange={(e) => sField("office", e.target.value)}
                    />
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
        <div className="modal-overlay" onClick={() => { if (!staffActioning) { setStaffActionTarget(null); setStaffActionResult(null); setStaffActionError(""); } }}>
          <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
            {staffActionResult ? (
              <>
                <h2 className="modal__title">
                  {staffActionResult.kind === "promote" ? "Promotion Complete" : "Staff Member Removed"}
                </h2>
                <p className="modal__body">
                  <strong>{staffActionTarget.person.full_name}</strong>{" "}
                  {staffActionResult.kind === "promote"
                    ? `has been promoted to ${roleLabel(nextPromotionRole(staffActionTarget.person.role))}.`
                    : "has been removed."}
                </p>
                <ul style={{ margin: "8px 0 12px 18px", fontSize: 14, color: "var(--text)" }}>
                  {staffActionResult.kind === "promote" ? (
                    <li>Removed from {staffActionResult.summary.courseAssignments} TA course assignment{staffActionResult.summary.courseAssignments === 1 ? "" : "s"} — re-assign as professor where needed</li>
                  ) : (
                    <>
                      <li>Account access revoked</li>
                      <li>Un-assigned from {staffActionResult.summary.courseAssignments} course{staffActionResult.summary.courseAssignments === 1 ? "" : "s"}</li>
                      <li>{staffActionResult.summary.reservations} room reservation{staffActionResult.summary.reservations === 1 ? "" : "s"} cancelled</li>
                    </>
                  )}
                </ul>
                {staffActionResult.errors.length > 0 && (
                  <p className="error-msg" style={{ fontSize: 13 }}>
                    Some cleanup failed: {staffActionResult.errors.join("; ")}
                  </p>
                )}
                <div className="modal-actions">
                  <BtnPrimary onClick={() => { setStaffActionTarget(null); setStaffActionResult(null); }}>Done</BtnPrimary>
                </div>
              </>
            ) : (
              <>
                <h2 className="modal__title">
                  {staffActionTarget.action === "restore" ? "Restore Staff Member?" :
                   staffActionTarget.action === "promote"
                     ? `Promote to ${roleLabel(nextPromotionRole(staffActionTarget.person.role))}?`
                     : "Remove Staff Member?"}
                </h2>
                <p className="modal__body">
                  {staffActionTarget.action === "restore"
                    ? `Restore ${staffActionTarget.person.full_name}'s account? They will be able to log in again. Previous course assignments and reservations are not restored — re-assign them manually if needed.`
                    : staffActionTarget.action === "promote"
                      ? `Promote ${staffActionTarget.person.full_name} from ${roleLabel(staffActionTarget.person.role)} to ${roleLabel(nextPromotionRole(staffActionTarget.person.role))}? This changes their system access level.`
                      : `Remove ${staffActionTarget.person.full_name}? Their account will be locked, they will be un-assigned from all courses, and any pending or confirmed room reservations will be cancelled. Restoring the account does not restore these.`}
                </p>
                {staffActionError && <p className="error-msg">{staffActionError}</p>}
                <div className="modal-actions">
                  <BtnGhost onClick={() => { setStaffActionTarget(null); setStaffActionError(""); }}>Cancel</BtnGhost>
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
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
