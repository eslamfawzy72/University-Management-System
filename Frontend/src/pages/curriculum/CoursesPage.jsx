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
  professor_staff_id: "",
  ta_staff_ids: [],
};

export default function CoursesPage() {
  const navigate = useNavigate();
  const { is } = useRole();
  const { profile } = useAuth();
  const canManage = is("admin");
  const isStudent = is("student");

  const [courses, setCourses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [staffOptions, setStaffOptions] = useState([]);
  const [courseStaffByCourse, setCourseStaffByCourse] = useState({});
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
  const [formError, setFormError] = useState("");

  // Search & filter state
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterDept, setFilterDept] = useState("all");

  const professorOptions = staffOptions.filter((s) => s.role === "professor");
  const taOptions = staffOptions.filter((s) => s.role === "ta");

  function staffNameById(staffId) {
    const match = staffOptions.find((s) => s.id === staffId);
    return match ? match.full_name : null;
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [
      { data: c, error: cErr },
      { data: d, error: dErr },
      { data: staffRows, error: sErr },
      { data: csRows, error: csErr },
    ] = await Promise.all([
      supabase.from("courses").select("*, departments(name)").order("code"),
      supabase.from("departments").select("id, name").order("name"),
      supabase.from("staff").select("id, profile_id, title, profiles(id, full_name, email, role)"),
      supabase.from("course_staff").select("id, course_id, staff_id, role"),
    ]);

    const firstErr = cErr || dErr || sErr || csErr;
    if (firstErr) { setError(firstErr.message); setLoading(false); return; }

    setCourses(c || []);
    setDepartments(d || []);

    const mappedStaff = (staffRows || [])
      .filter((s) => s.profiles && (s.profiles.role === "professor" || s.profiles.role === "ta"))
      .map((s) => ({
        id: s.id,
        profile_id: s.profile_id,
        full_name: s.profiles.full_name,
        email: s.profiles.email,
        role: s.profiles.role,
        title: s.title,
      }))
      .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
    setStaffOptions(mappedStaff);

    const grouped = {};
    for (const row of csRows || []) {
      if (!grouped[row.course_id]) grouped[row.course_id] = [];
      grouped[row.course_id].push(row);
    }
    setCourseStaffByCourse(grouped);

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
    setEnrolling(course.id);

    // Live capacity check — the in-memory enrolledCounts is from page load
    // and may be stale if other students have enrolled in the meantime.
    if (course.capacity != null) {
      const { count, error: countErr } = await supabase
        .from("course_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("course_id", course.id)
        .eq("status", "enrolled");
      if (countErr) { alert("Could not verify seat availability: " + countErr.message); setEnrolling(null); return; }
      if ((count ?? 0) >= course.capacity) {
        alert("This course is now full — the last seat was just taken. Refreshing the catalog.");
        setEnrolling(null);
        load();
        return;
      }
    }

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
    setFormError("");
    setModal("form");
  }

  function openEdit(e, course) {
    e.stopPropagation();
    const assigned = courseStaffByCourse[course.id] || [];
    const professorRow = assigned.find((r) => r.role === "professor");
    const taRows = assigned.filter((r) => r.role === "ta");
    setForm({
      name: course.name,
      code: course.code,
      description: course.description || "",
      type: course.type || "core",
      capacity: course.capacity ?? "",
      department_id: course.department_id || "",
      is_active: course.is_active ?? true,
      professor_staff_id: professorRow?.staff_id || "",
      ta_staff_ids: taRows.map((r) => r.staff_id),
    });
    setEditingId(course.id);
    setFormError("");
    setModal("form");
  }

  function confirmDelete(e, id) {
    e.stopPropagation();
    setDeleteId(id);
    setModal("delete");
  }

  function toggleTa(staffId) {
    setForm((f) => {
      const set = new Set(f.ta_staff_ids);
      if (set.has(staffId)) set.delete(staffId);
      else set.add(staffId);
      return { ...f, ta_staff_ids: [...set] };
    });
  }

  async function syncCourseStaff(courseId) {
    const { error: delErr } = await supabase
      .from("course_staff")
      .delete()
      .eq("course_id", courseId);
    if (delErr) return delErr;

    const rows = [];
    if (form.professor_staff_id) {
      rows.push({ course_id: courseId, staff_id: form.professor_staff_id, role: "professor" });
    }
    for (const taId of form.ta_staff_ids) {
      rows.push({ course_id: courseId, staff_id: taId, role: "ta" });
    }
    if (rows.length === 0) return null;
    const { error: insErr } = await supabase.from("course_staff").insert(rows);
    return insErr || null;
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    const {
      professor_staff_id: _p,
      ta_staff_ids: _t,
      ...courseFields
    } = form;
    const payload = {
      ...courseFields,
      capacity: form.capacity !== "" ? Number(form.capacity) : null,
      department_id: form.department_id || null,
    };

    let courseId = editingId;
    if (editingId) {
      const { error: err } = await supabase.from("courses").update(payload).eq("id", editingId);
      if (err) { setSaving(false); setFormError(err.message); return; }
    } else {
      const { data: inserted, error: err } = await supabase
        .from("courses")
        .insert(payload)
        .select("id")
        .single();
      if (err) { setSaving(false); setFormError(err.message); return; }
      courseId = inserted.id;
    }

    const staffErr = await syncCourseStaff(courseId);
    setSaving(false);
    if (staffErr) {
      setFormError(`Course saved, but staff assignment failed: ${staffErr.message}`);
      return;
    }
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

  const filteredCourses = courses.filter((c) => {
    if (filterType !== "all" && c.type !== filterType) return false;
    if (filterDept !== "all" && c.department_id !== filterDept) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack = `${c.code} ${c.name} ${c.description ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return (
    <AppShell title="Courses" subtitle="Browse the course catalog">
      <div className="dashboard-stack">
        <div className="page-header" style={{ flexWrap: "wrap", gap: 8 }}>
          <input
            className="search-input"
            placeholder="Search by code, name, or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">All types</option>
            <option value="core">Core</option>
            <option value="elective">Elective</option>
          </select>
          <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          {canManage && <BtnPrimary onClick={openCreate}>+ New Course</BtnPrimary>}
        </div>

        {loading && <p className="text-muted">Loading courses…</p>}
        {error && <p className="error-msg">{error}</p>}

        {!loading && !error && courses.length === 0 && (
          <p className="empty-state">No courses found. {canManage && "Create your first course above."}</p>
        )}

        {!loading && !error && courses.length > 0 && filteredCourses.length === 0 && (
          <p className="empty-state">No courses match your search.</p>
        )}

        {!loading && !error && filteredCourses.length > 0 && (
          <div className="course-grid">
            {filteredCourses.map((c) => {
              const seats = availableSeats(c);
              const myStatus = enrollmentStatuses[c.id]; // "pending" | "enrolled" | undefined
              const isEnrolled = myStatus === "enrolled";
              const isPending = myStatus === "pending";
              const isFull = seats != null && seats <= 0;
              const canEnroll = isStudent && c.is_active && !myStatus && !isFull;
              const canNavigate = !isStudent || isEnrolled;
              const assigned = courseStaffByCourse[c.id] || [];
              const profRow = assigned.find((r) => r.role === "professor");
              const taRows = assigned.filter((r) => r.role === "ta");
              const profName = profRow ? staffNameById(profRow.staff_id) : null;
              const taNames = taRows.map((r) => staffNameById(r.staff_id)).filter(Boolean);

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

                  {(profName || taNames.length > 0) && (
                    <div className="course-card__staff">
                      {profName && (
                        <div className="course-card__staff-row">
                          <span className="course-card__staff-label">Professor</span>
                          <span className="course-card__staff-value">{profName}</span>
                        </div>
                      )}
                      {taNames.length > 0 && (
                        <div className="course-card__staff-row">
                          <span className="course-card__staff-label">
                            TA{taNames.length > 1 ? "s" : ""}
                          </span>
                          <span className="course-card__staff-value">{taNames.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="course-card__meta">
                    {c.departments?.name && (
                      <span className="course-card__meta-item">{c.departments.name}</span>
                    )}
                    {canManage && (
                      <span className="chip chip-green">
                        {enrolledCounts[c.id] || 0} enrolled
                        {c.capacity != null ? ` / ${c.capacity}` : ""}
                      </span>
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
            {formError && <p className="error-msg">{formError}</p>}
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
              <div className="field">
                <span>Professor</span>
                <select
                  value={form.professor_staff_id}
                  onChange={(e) => field("professor_staff_id", e.target.value)}
                >
                  <option value="">— Unassigned —</option>
                  {professorOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}{s.email ? ` (${s.email})` : ""}
                    </option>
                  ))}
                </select>
                {professorOptions.length === 0 && (
                  <small className="text-muted">
                    No professors found in the staff directory yet.
                  </small>
                )}
              </div>

              <div className="field">
                <span>Teaching Assistants</span>
                {taOptions.length === 0 ? (
                  <small className="text-muted">
                    No TAs found in the staff directory yet.
                  </small>
                ) : (
                  <div className="checkbox-list">
                    {taOptions.map((s) => (
                      <label key={s.id} className="field-checkbox">
                        <input
                          type="checkbox"
                          checked={form.ta_staff_ids.includes(s.id)}
                          onChange={() => toggleTa(s.id)}
                        />
                        <span>{s.full_name}{s.email ? ` (${s.email})` : ""}</span>
                      </label>
                    ))}
                  </div>
                )}
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
