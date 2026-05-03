import { useEffect, useState } from "react";

import AppShell from "../../components/layout/AppShell";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts) {
  if (!ts) return "—";
  const normalized = ts.endsWith("Z") ? ts : ts + "Z";
  return new Date(normalized).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function scorePercent(score, max) {
  if (!max) return null;
  return Math.round((score / max) * 100);
}

function gradeChipClass(pct) {
  if (pct === null) return "chip chip-gray";
  if (pct >= 90) return "chip chip-green";
  if (pct >= 75) return "chip chip-blue";
  if (pct >= 60) return "chip chip-gold";
  return "chip chip-red";
}

// ── Section: child info header ────────────────────────────────────────────────

function ChildHeader({ child }) {
  return (
    <article className="content-card parent-child-header">
      <div className="parent-child-header__info">
        <span className="chip chip-blue">Student</span>
        <h2 className="parent-child-header__name">{child.full_name}</h2>
        <p className="parent-child-header__meta">
          {child.student_number && <span>#{child.student_number}</span>}
          {child.email && <span>{child.email}</span>}
        </p>
      </div>
    </article>
  );
}

// ── Section: courses ─────────────────────────────────────────────────────────

function CoursesSection({ studentId }) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) return;
    supabase
      .from("course_enrollments")
      .select("status, courses(id, code, name, description, type, departments(name))")
      .eq("student_id", studentId)
      .eq("status", "enrolled")
      .then(({ data }) => {
        setCourses((data ?? []).map((e) => e.courses).filter(Boolean));
        setLoading(false);
      });
  }, [studentId]);

  return (
    <article className="content-card">
      <h2 className="parent-section__title">Enrolled Courses</h2>
      {loading && <p className="text-muted" style={{ marginTop: 8 }}>Loading…</p>}
      {!loading && courses.length === 0 && (
        <p className="text-muted" style={{ marginTop: 8 }}>Not enrolled in any courses yet.</p>
      )}
      {!loading && courses.length > 0 && (
        <div className="parent-courses-grid">
          {courses.map((c) => (
            <div key={c.id} className="parent-course-card">
              <div className="parent-course-card__top">
                <span className="chip chip-blue">{c.code}</span>
                {c.type && <span className="chip chip-gray">{c.type}</span>}
              </div>
              <p className="parent-course-card__name">{c.name}</p>
              {c.departments?.name && (
                <p className="parent-course-card__dept">{c.departments.name}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

// ── Section: grades ───────────────────────────────────────────────────────────

function GradesSection({ studentId }) {
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) return;
    supabase
      .from("assignment_grades")
      .select("id, score, max_score, feedback, graded_at, assignments(title, type, courses(code, name))")
      .eq("student_id", studentId)
      .order("graded_at", { ascending: false })
      .then(({ data }) => {
        setGrades(data ?? []);
        setLoading(false);
      });
  }, [studentId]);

  const avg = grades.length
    ? Math.round(grades.reduce((sum, g) => sum + scorePercent(g.score, g.max_score), 0) / grades.length)
    : null;

  return (
    <article className="content-card">
      <div className="parent-section__titlerow">
        <h2 className="parent-section__title">Grades</h2>
        {avg !== null && (
          <span className={gradeChipClass(avg)}>Average: {avg}%</span>
        )}
      </div>
      {loading && <p className="text-muted" style={{ marginTop: 8 }}>Loading…</p>}
      {!loading && grades.length === 0 && (
        <p className="text-muted" style={{ marginTop: 8 }}>No grades recorded yet.</p>
      )}
      {!loading && grades.length > 0 && (
        <div className="parent-grades-table-wrap">
          <table className="parent-grades-table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Assignment</th>
                <th>Type</th>
                <th>Score</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => {
                const pct = scorePercent(g.score, g.max_score);
                return (
                  <tr key={g.id}>
                    <td>{g.assignments?.courses?.code ?? "—"}</td>
                    <td>{g.assignments?.title ?? "—"}</td>
                    <td>{g.assignments?.type ?? "—"}</td>
                    <td>
                      <span className={gradeChipClass(pct)}>
                        {g.score}/{g.max_score} ({pct}%)
                      </span>
                    </td>
                    <td className="parent-grades-table__feedback">
                      {g.feedback || <span className="text-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

// ── Root page ─────────────────────────────────────────────────────────────────

export default function ParentDashboardPage() {
  const { profile } = useAuth();

  const [child, setChild] = useState(null);
  const [studentId, setStudentId] = useState(null);
  const [loadingChild, setLoadingChild] = useState(true);

  useEffect(() => {
    if (!profile?.id) return;

    async function loadChild() {
      const { data: parentRow } = await supabase
        .from("parents")
        .select("student_id")
        .eq("profile_id", profile.id)
        .maybeSingle();

      if (!parentRow) { setLoadingChild(false); return; }

      const { data: studentRow } = await supabase
        .from("students")
        .select("id, student_number, profile_id")
        .eq("id", parentRow.student_id)
        .maybeSingle();

      if (!studentRow) { setLoadingChild(false); return; }

      const { data: childProfile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", studentRow.profile_id)
        .maybeSingle();

      setStudentId(studentRow.id);
      setChild({
        full_name: childProfile?.full_name ?? "Unknown",
        email: childProfile?.email ?? "",
        student_number: studentRow.student_number,
      });
      setLoadingChild(false);
    }

    loadChild();
  }, [profile?.id]);

  if (loadingChild) {
    return (
      <AppShell title="Parent Dashboard" subtitle="Loading your child's information…">
        <p className="text-muted">Loading…</p>
      </AppShell>
    );
  }

  if (!child) {
    return (
      <AppShell title="Parent Dashboard" subtitle="No linked student found.">
        <article className="content-card">
          <p className="text-muted">
            Your account is not linked to a student yet. Please contact the administration.
          </p>
        </article>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Parent Dashboard"
      subtitle={`Viewing progress for ${child.full_name}`}
    >
      <section className="dashboard-stack">
        <ChildHeader child={child} />
        <CoursesSection studentId={studentId} />
        <GradesSection studentId={studentId} />
      </section>
    </AppShell>
  );
}
