import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../components/layout/AppShell";
import { BtnPrimary, BtnGhost } from "../../components/ui/Buttons";
import { useRole } from "../../hooks/useRole";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";

const EMPTY_FORM = {
  name: "",
  code: "",
  description: "",
  type: "core",
  capacity: "",
  department_id: "",
  is_active: true,
};

export default function CoursesPage() {
  const navigate = useNavigate();
  const { is } = useRole();
  const { profile } = useAuth();
  const canManage = is("admin");
  const isStudent = is("student");

  const [courses, setCourses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [enrollmentStatuses, setEnrollmentStatuses] = useState({});
  const [enrolledCounts, setEnrolledCounts] = useState({});
  const [studentId, setStudentId] = useState(null);
  const [enrolling, setEnrolling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [{ data: c, error: cErr }, { data: d, error: dErr }] = await Promise.all([
      supabase.from("courses").select("*, departments(name)").order("code"),
      supabase.from("departments").select("id, name").order("name"),
    ]);

    if (cErr || dErr) { setError((cErr || dErr).message); setLoading(false); return; }

    setCourses(c || []);
    setDepartments(d || []);

    // Count only enrolled (approved) for seat display
    const { data: allEnrollments } = await supabase
      .from("course_enrollments")
      .select("course_id")
      .eq("status", "enrolled");

    const counts = {};
    (allEnrollments || []).forEach((e) => {
      counts[e.course_id] = (counts[e.course_id] || 0) + 1;
    });
    setEnrolledCounts(counts);

    // If student, get their student record + their enrollments with status
    if (isStudent && profile?.id) {
      const { data: studentRec } = await supabase
        .from("students")
        .select("id")
        .eq("profile_id", profile.id)
        .single();

      if (studentRec) {
        setStudentId(studentRec.id);
        const { data: myEnrollments } = await supabase
          .from("course_enrollments")
          .select("course_id, status")
          .eq("student_id", studentRec.id)
          .in("status", ["pending", "enrolled"]);
        const statusMap = {};
        (myEnrollments || []).forEach((e) => { statusMap[e.course_id] = e.status; });
        setEnrollmentStatuses(statusMap);
      }
    }

    setLoading(false);
  }, [isStudent, profile?.id]);

  useEffect(() => { load(); }, [load]);

  async function handleEnroll(e, course) {
    e.stopPropagation();

    const available = course.capacity != null
      ? course.capacity - (enrolledCounts[course.id] || 0)
      : Infinity;
    if (available <= 0) { alert("No seats available for this course."); return; }

    setEnrolling(course.id);

    // Auto-create student record if it doesn't exist yet
    let sid = studentId;
    if (!sid) {
      const { data: existing } = await supabase
        .from("students")
        .select("id")
        .eq("profile_id", profile.id)
        .single();

      if (existing) {
        sid = existing.id;
      } else {
        const { data: created, error: createErr } = await supabase
          .from("students")
          .insert({
            profile_id: profile.id,
            status: "active",
            enrollment_date: new Date().toISOString().split("T")[0],
          })
          .select("id")
          .single();
        if (createErr) { alert("Could not create student record: " + createErr.message); setEnrolling(null); return; }
        sid = created.id;
      }
      setStudentId(sid);
    }

    const { error: err } = await supabase.from("course_enrollments").insert({
      course_id: course.id,
      student_id: sid,
      status: "pending",
      enrolled_at: new Date().toISOString(),
    });
    setEnrolling(null);
    if (err) { alert(err.message); return; }
    load();
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setModal("form");
  }

  function openEdit(e, course) {
    e.stopPropagation();
    setForm({
      name: course.name,
      code: course.code,
      description: course.description || "",
      type: course.type || "core",
      capacity: course.capacity ?? "",
      department_id: course.department_id || "",
      is_active: course.is_active ?? true,
    });
    setEditingId(course.id);
    setModal("form");
  }

  function confirmDelete(e, id) {
    e.stopPropagation();
    setDeleteId(id);
    setModal("delete");
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      ...form,
      capacity: form.capacity !== "" ? Number(form.capacity) : null,
      department_id: form.department_id || null,
    };
    const { error: err } = editingId
      ? await supabase.from("courses").update(payload).eq("id", editingId)
      : await supabase.from("courses").insert(payload);
    setSaving(false);
    if (err) { alert(err.message); return; }
    setModal(null);
    load();
  }

  async function handleDelete() {
    const { error: err } = await supabase.from("courses").delete().eq("id", deleteId);
    if (err) { alert(err.message); return; }
    setModal(null);
    setDeleteId(null);
    load();
  }

  function field(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function availableSeats(course) {
    if (course.capacity == null) return null;
    return course.capacity - (enrolledCounts[course.id] || 0);
  }

  return (
    <AppShell title="Courses" subtitle="Browse the course catalog">
      <div className="dashboard-stack">
        {canManage && (
          <div className="page-header">
            <BtnPrimary onClick={openCreate}>+ New Course</BtnPrimary>
          </div>
        )}

        {loading && <p className="text-muted">Loading courses…</p>}
        {error && <p className="error-msg">{error}</p>}

        {!loading && !error && courses.length === 0 && (
          <p className="empty-state">No courses found. {canManage && "Create your first course above."}</p>
        )}

        {!loading && !error && courses.length > 0 && (
          <div className="course-grid">
            {courses.map((c) => {
              const seats = availableSeats(c);
              const myStatus = enrollmentStatuses[c.id]; // "pending" | "enrolled" | undefined
              const isEnrolled = myStatus === "enrolled";
              const isPending = myStatus === "pending";
              const isFull = seats != null && seats <= 0;
              const canEnroll = isStudent && c.is_active && !myStatus && !isFull;
              const canNavigate = canManage || isEnrolled;

              return (
                <div
                  key={c.id}
                  className={`course-card${!c.is_active ? " course-card--inactive" : ""}${!canNavigate ? " course-card--locked" : ""}`}
                  onClick={() => canNavigate && navigate(`/curriculum/courses/${c.id}`)}
                >
                  <div className="course-card__header">
                    <span className="code-badge">{c.code}</span>
                    <span className={c.type === "core" ? "chip chip-blue" : "chip chip-gold"}>
                      {c.type === "core" ? "Core" : "Elective"}
                    </span>
                  </div>

                  <h3 className="course-card__name">{c.name}</h3>

                  {c.description && (
                    <p className="course-card__desc">{c.description}</p>
                  )}

                  <div className="course-card__meta">
                    {c.departments?.name && (
                      <span className="course-card__meta-item">{c.departments.name}</span>
                    )}
                    {seats != null && (
                      <span className={`course-card__seats${isFull ? " course-card__seats--full" : ""}`}>
                        {isFull ? "Full" : `${seats} seat${seats !== 1 ? "s" : ""} left`}
                      </span>
                    )}
                    {isPending && <span className="chip chip-gold">Pending Approval</span>}
                    {isEnrolled && <span className="chip chip-green">Enrolled</span>}
                    {!c.is_active && <span className="chip chip-gray">Inactive</span>}
                  </div>

                  {(canManage || canEnroll || isEnrolled) && (
                    <div className="course-card__actions">
                      {canManage && (
                        <>
                          <BtnGhost className="btn-xs" onClick={(e) => openEdit(e, c)}>Edit</BtnGhost>
                          <BtnGhost className="btn-xs btn-ghost-danger" onClick={(e) => confirmDelete(e, c.id)}>Delete</BtnGhost>
                        </>
                      )}
                      {canEnroll && (
                        <BtnPrimary
                          className="btn-xs"
                          disabled={enrolling === c.id}
                          onClick={(e) => handleEnroll(e, c)}
                        >
                          {enrolling === c.id ? "Requesting…" : "Request Enrollment"}
                        </BtnPrimary>
                      )}
                      {isStudent && isFull && !isEnrolled && (
                        <span className="chip chip-red" style={{ fontSize: 11 }}>Course Full</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modal === "form" && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">{editingId ? "Edit Course" : "New Course"}</h2>
            <form className="auth-form" onSubmit={handleSave}>
              <div className="form-row-2">
                <div className="field">
                  <span>Course Code</span>
                  <input required placeholder="e.g. CS101" value={form.code} onChange={(e) => field("code", e.target.value)} />
                </div>
                <div className="field">
                  <span>Type</span>
                  <select value={form.type} onChange={(e) => field("type", e.target.value)}>
                    <option value="core">Core</option>
                    <option value="elective">Elective</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <span>Course Name</span>
                <input required placeholder="e.g. Introduction to Computer Science" value={form.name} onChange={(e) => field("name", e.target.value)} />
              </div>
              <div className="field">
                <span>Description</span>
                <textarea rows={3} placeholder="Course description…" value={form.description} onChange={(e) => field("description", e.target.value)} />
              </div>
              <div className="form-row-2">
                <div className="field">
                  <span>Department</span>
                  <select value={form.department_id} onChange={(e) => field("department_id", e.target.value)}>
                    <option value="">— None —</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <span>Capacity</span>
                  <input type="number" min="1" placeholder="e.g. 30" value={form.capacity} onChange={(e) => field("capacity", e.target.value)} />
                </div>
              </div>
              <label className="field-checkbox">
                <input type="checkbox" checked={form.is_active} onChange={(e) => field("is_active", e.target.checked)} />
                <span>Active</span>
              </label>
              <div className="modal-actions">
                <BtnGhost type="button" onClick={() => setModal(null)}>Cancel</BtnGhost>
                <BtnPrimary type="submit" disabled={saving}>
                  {saving ? "Saving…" : editingId ? "Save Changes" : "Create Course"}
                </BtnPrimary>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal === "delete" && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">Delete Course?</h2>
            <p className="modal__body">This will permanently remove the course and cannot be undone.</p>
            <div className="modal-actions">
              <BtnGhost onClick={() => setModal(null)}>Cancel</BtnGhost>
              <BtnPrimary className="btn-danger" onClick={handleDelete}>Delete</BtnPrimary>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
