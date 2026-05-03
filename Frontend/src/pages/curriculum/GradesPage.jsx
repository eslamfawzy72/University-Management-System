import { useState, useEffect, useCallback } from "react";
import AppShell from "../../components/layout/AppShell";
import { BtnPrimary, BtnGhost } from "../../components/ui/Buttons";
import { useRole } from "../../hooks/useRole";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function GradesPage() {
  const { is, isAny } = useRole();
  const { profile } = useAuth();
  const isStudent = is("student");
  const isStaff = isAny(["professor", "ta", "admin"]);

  if (isStudent) return <StudentGradesView profileId={profile?.id} />;
  if (isStaff) return <StaffGradesView profileId={profile?.id} isAdmin={is("admin")} />;
  return (
    <AppShell title="Grades" subtitle="">
      <p className="text-muted">No grades view available for your role.</p>
    </AppShell>
  );
}

// ─── Student view ──────────────────────────────────────────────────────────
function StudentGradesView({ profileId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);

      const { data: studentRec, error: sErr } = await supabase
        .from("students")
        .select("id")
        .eq("profile_id", profileId)
        .maybeSingle();
      if (sErr) {
        if (!cancelled) { setError(sErr.message); setLoading(false); }
        return;
      }
      if (!studentRec) {
        // Student has no enrollment record yet — show empty state, not an error.
        if (!cancelled) { setRows([]); setLoading(false); }
        return;
      }

      // Get grades joined to assignment + course
      const { data, error: gErr } = await supabase
        .from("assignment_grades")
        .select(`
          id, score, max_score, feedback, graded_at,
          assignments(id, title, type, due_date, courses(id, code, name))
        `)
        .eq("student_id", studentRec.id)
        .order("graded_at", { ascending: false });

      if (gErr) {
        if (!cancelled) { setError(gErr.message); setLoading(false); }
        return;
      }
      if (!cancelled) {
        setRows(
          (data || [])
            .filter((r) => r.assignments)
            .map((r) => ({
              id: r.id,
              score: r.score,
              maxScore: r.max_score,
              feedback: r.feedback,
              gradedAt: r.graded_at,
              title: r.assignments.title,
              type: r.assignments.type,
              courseCode: r.assignments.courses?.code,
              courseName: r.assignments.courses?.name,
            }))
        );
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [profileId]);

  const totalEarned = rows.reduce((sum, r) => sum + Number(r.score || 0), 0);
  const totalMax = rows.reduce((sum, r) => sum + Number(r.maxScore || 0), 0);
  const avgPct = totalMax > 0 ? Math.round((totalEarned / totalMax) * 100) : null;

  return (
    <AppShell title="My Grades" subtitle="View your published grades and feedback">
      <div className="dashboard-stack">
        {loading && <p className="text-muted">Loading grades…</p>}
        {error && <p className="error-msg">{error}</p>}

        {!loading && !error && (
          <div className="content-card">
            <h2>Grade Summary</h2>
            <div className="grades-summary">
              <div className="grades-summary__item">
                <span className="grades-summary__label">Graded items</span>
                <span className="grades-summary__value">{rows.length}</span>
              </div>
              <div className="grades-summary__item">
                <span className="grades-summary__label">Total points</span>
                <span className="grades-summary__value">{totalEarned} / {totalMax}</span>
              </div>
              <div className="grades-summary__item">
                <span className="grades-summary__label">Average</span>
                <span className="grades-summary__value">{avgPct != null ? `${avgPct}%` : "—"}</span>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="empty-state">No grades have been published for you yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Course</th>
                      <th>Assignment</th>
                      <th>Type</th>
                      <th>Score</th>
                      <th>%</th>
                      <th>Feedback</th>
                      <th>Graded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const pct = r.maxScore > 0 ? Math.round((r.score / r.maxScore) * 100) : null;
                      return (
                        <tr key={r.id}>
                          <td>
                            <span className="code-badge">{r.courseCode ?? "—"}</span>
                            <span className="text-muted" style={{ marginLeft: 8 }}>{r.courseName}</span>
                          </td>
                          <td className="col-name">{r.title}</td>
                          <td>
                            <span className={r.type === "quiz" ? "chip chip-gold" : "chip chip-blue"}>
                              {r.type === "quiz" ? "Quiz" : "Assignment"}
                            </span>
                          </td>
                          <td className="score-cell">{r.score} / {r.maxScore}</td>
                          <td className="score-cell">{pct != null ? `${pct}%` : "—"}</td>
                          <td className="text-muted">{r.feedback || "—"}</td>
                          <td>{formatDate(r.gradedAt)}</td>
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
    </AppShell>
  );
}

// ─── Staff view ────────────────────────────────────────────────────────────
function StaffGradesView({ profileId, isAdmin }) {
  const [courses, setCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [assignments, setAssignments] = useState([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [students,    setStudents]    = useState([]); // [{ studentId, profileId, fullName, email }]
  const [grades,      setGrades]      = useState({}); // studentId -> { id, score, max_score, feedback }
  const [submissions, setSubmissions] = useState({}); // studentId -> { content, submitted_at }
  const [viewingSub,  setViewingSub]  = useState(null); // { fullName, content, submittedAt }
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [savingId,    setSavingId]    = useState(null);
  const [saveError,   setSaveError]   = useState(null);

  // Load courses the user can manage
  const loadCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (isAdmin) {
      const { data, error: err } = await supabase
        .from("courses")
        .select("id, code, name")
        .order("code");
      if (err) { setError(err.message); setLoading(false); return; }
      setCourses(data || []);
      if ((data || []).length > 0) setSelectedCourseId(data[0].id);
      setLoading(false);
      return;
    }
    // Professor/TA: only courses where they are assigned
    const { data: staffRec, error: stErr } = await supabase
      .from("staff")
      .select("id")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (stErr) { setError(stErr.message); setLoading(false); return; }
    if (!staffRec) { setCourses([]); setLoading(false); return; }

    const { data: cs } = await supabase
      .from("course_staff")
      .select("courses(id, code, name)")
      .eq("staff_id", staffRec.id);
    const myCourses = (cs || [])
      .map((r) => r.courses)
      .filter(Boolean)
      .sort((a, b) => (a.code || "").localeCompare(b.code || ""));
    setCourses(myCourses);
    if (myCourses.length > 0) setSelectedCourseId(myCourses[0].id);
    setLoading(false);
  }, [profileId, isAdmin]);

  useEffect(() => { loadCourses(); }, [loadCourses]);

  // Load assignments for the selected course
  useEffect(() => {
    if (!selectedCourseId) {
      setAssignments([]);
      setSelectedAssignmentId("");
      return;
    }
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("assignments")
        .select("id, title, type, due_date")
        .eq("course_id", selectedCourseId)
        .order("due_date", { ascending: true });
      if (cancelled) return;
      setAssignments(data || []);
      setSelectedAssignmentId((data || [])[0]?.id ?? "");
    }
    load();
    return () => { cancelled = true; };
  }, [selectedCourseId]);

  // Load enrolled students + their grades + submissions for the selected assignment
  useEffect(() => {
    if (!selectedCourseId || !selectedAssignmentId) {
      setStudents([]);
      setGrades({});
      setSubmissions({});
      return;
    }
    let cancelled = false;
    async function load() {
      const { data: enrollments } = await supabase
        .from("course_enrollments")
        .select("students(id, profile_id, profiles(full_name, email))")
        .eq("course_id", selectedCourseId)
        .eq("status", "enrolled");

      if (cancelled) return;
      const studentList = (enrollments || [])
        .map((r) => r.students)
        .filter(Boolean)
        .map((s) => ({
          studentId: s.id,
          profileId: s.profile_id,
          fullName: s.profiles?.full_name ?? "Unknown",
          email: s.profiles?.email ?? "",
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
      setStudents(studentList);

      const [{ data: gradeRows }, { data: subRows }] = await Promise.all([
        supabase
          .from("assignment_grades")
          .select("id, student_id, score, max_score, feedback")
          .eq("assignment_id", selectedAssignmentId),
        supabase
          .from("assignment_submissions")
          .select("student_id, content, submitted_at")
          .eq("assignment_id", selectedAssignmentId),
      ]);
      if (cancelled) return;

      const gMap = {};
      (gradeRows || []).forEach((g) => { gMap[g.student_id] = g; });
      setGrades(gMap);

      const sMap = {};
      (subRows || []).forEach((s) => { sMap[s.student_id] = s; });
      setSubmissions(sMap);
    }
    load();
    return () => { cancelled = true; };
  }, [selectedCourseId, selectedAssignmentId]);

  function updateLocal(studentId, key, value) {
    setGrades((g) => ({
      ...g,
      [studentId]: { ...(g[studentId] ?? { max_score: 100 }), [key]: value },
    }));
  }

  async function saveGrade(studentId) {
    setSaveError(null);
    const g = grades[studentId];
    if (!g || g.score === "" || g.score == null) {
      setSaveError("Enter a score before saving.");
      return;
    }
    const score = Number(g.score);
    const maxScore = Number(g.max_score ?? 100);
    if (Number.isNaN(score) || Number.isNaN(maxScore)) {
      setSaveError("Score and max score must be numbers.");
      return;
    }
    if (maxScore <= 0) {
      setSaveError("Max score must be greater than 0.");
      return;
    }
    if (score < 0 || score > maxScore) {
      setSaveError(`Score must be between 0 and ${maxScore}.`);
      return;
    }

    setSavingId(studentId);
    const payload = {
      assignment_id: selectedAssignmentId,
      student_id: studentId,
      score,
      max_score: maxScore,
      feedback: g.feedback ?? null,
      graded_by: profileId,
      graded_at: new Date().toISOString(),
    };
    let saved, err;
    if (g.id) {
      ({ data: saved, error: err } = await supabase
        .from("assignment_grades")
        .update(payload)
        .eq("id", g.id)
        .select()
        .single());
    } else {
      ({ data: saved, error: err } = await supabase
        .from("assignment_grades")
        .insert(payload)
        .select()
        .single());
    }
    setSavingId(null);
    if (err) { setSaveError(err.message); return; }
    if (saved) {
      setGrades((cur) => ({ ...cur, [studentId]: saved }));
    }
  }

  return (
    <AppShell title="Grades" subtitle="Enter and review student grades">
      <div className="dashboard-stack">
        {loading && <p className="text-muted">Loading…</p>}
        {error && <p className="error-msg">{error}</p>}

        {!loading && courses.length === 0 && (
          <p className="empty-state">
            You are not assigned to any courses yet. An admin needs to assign you on a course before you can grade.
          </p>
        )}

        {!loading && courses.length > 0 && (
          <>
            <div className="page-header" style={{ flexWrap: "wrap", gap: 8 }}>
              <select value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} – {c.name}</option>
                ))}
              </select>
              <select
                value={selectedAssignmentId}
                onChange={(e) => setSelectedAssignmentId(e.target.value)}
                disabled={assignments.length === 0}
              >
                {assignments.length === 0 && <option value="">No assignments</option>}
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} ({a.type === "quiz" ? "Quiz" : "Assignment"})
                  </option>
                ))}
              </select>
            </div>

            <div className="content-card">
              <h2>Student Grades</h2>
              {saveError && <p className="error-msg">{saveError}</p>}
              {students.length === 0 ? (
                <p className="empty-state">No enrolled students for this course.</p>
              ) : !selectedAssignmentId ? (
                <p className="empty-state">Create or select an assignment to grade students.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Email</th>
                        <th>Submission</th>
                        <th>Score</th>
                        <th>Out of</th>
                        <th>Feedback</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s) => {
                        const g = grades[s.studentId] ?? {};
                        return (
                          <tr key={s.studentId}>
                            <td className="col-name">{s.fullName}</td>
                            <td className="text-muted">{s.email}</td>
                            <td>
                              {submissions[s.studentId] ? (
                                <button
                                  className="chip chip-green"
                                  style={{ cursor: "pointer", border: "none", background: "none", padding: 0 }}
                                  onClick={() => setViewingSub({
                                    fullName:    s.fullName,
                                    content:     submissions[s.studentId].content,
                                    submittedAt: submissions[s.studentId].submitted_at,
                                  })}
                                >
                                  Submitted ↗
                                </button>
                              ) : (
                                <span className="text-muted" style={{ fontSize: 13 }}>No submission</span>
                              )}
                            </td>
                            <td style={{ width: 100 }}>
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                value={g.score ?? ""}
                                onChange={(e) => updateLocal(s.studentId, "score", e.target.value)}
                                style={{ width: 80 }}
                              />
                            </td>
                            <td style={{ width: 100 }}>
                              <input
                                type="number"
                                step="0.5"
                                min="1"
                                value={g.max_score ?? 100}
                                onChange={(e) => updateLocal(s.studentId, "max_score", e.target.value)}
                                style={{ width: 80 }}
                              />
                            </td>
                            <td>
                              <input
                                placeholder="Optional comment…"
                                value={g.feedback ?? ""}
                                onChange={(e) => updateLocal(s.studentId, "feedback", e.target.value)}
                                style={{ width: "100%" }}
                              />
                            </td>
                            <td className="actions-cell">
                              <BtnPrimary
                                className="btn-xs"
                                disabled={savingId === s.studentId}
                                onClick={() => saveGrade(s.studentId)}
                              >
                                {savingId === s.studentId ? "Saving…" : g.id ? "Update" : "Save"}
                              </BtnPrimary>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {viewingSub && (
        <div className="modal-overlay" onClick={() => setViewingSub(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">{viewingSub.fullName}&apos;s Submission</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              Submitted {formatDate(viewingSub.submittedAt)}
            </p>
            <div style={{
              background: "var(--surface-raised, #f5f5f5)",
              borderRadius: 6,
              padding: "12px 16px",
              whiteSpace: "pre-wrap",
              fontSize: 14,
              lineHeight: 1.6,
              maxHeight: 400,
              overflowY: "auto",
            }}>
              {viewingSub.content || <em style={{ color: "var(--text-muted)" }}>No content</em>}
            </div>
            <div className="modal-actions">
              <BtnGhost onClick={() => setViewingSub(null)}>Close</BtnGhost>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
