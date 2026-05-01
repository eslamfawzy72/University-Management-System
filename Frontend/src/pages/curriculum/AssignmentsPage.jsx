import { useState, useEffect, useCallback } from "react";
import AppShell from "../../components/layout/AppShell";
import { BtnPrimary, BtnGhost } from "../../components/ui/Buttons";
import { useRole } from "../../hooks/useRole";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";

const EMPTY_FORM = {
  title: "",
  type: "assignment",
  due_date: "",
  course_id: "",
  is_published: false,
};

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isPast(due) {
  return due && new Date(due) < new Date();
}

export default function AssignmentsPage() {
  const { isAny } = useRole();
  const { profile } = useAuth();
  const canCreate = isAny(["professor", "ta", "admin"]);

  const [courses, setCourses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [filterCourse, setFilterCourse] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: a }] = await Promise.all([
      supabase.from("courses").select("id, name, code").eq("is_active", true).order("code"),
      supabase
        .from("assignments")
        .select("*, courses(name, code)")
        .order("due_date", { ascending: true }),
    ]);
    setCourses(c || []);
    setAssignments(a || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm({ ...EMPTY_FORM, course_id: courses[0]?.id || "" });
    setModal("create");
  }

  function field(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    const { error: err } = await supabase.from("assignments").insert({
      ...form,
      due_date: form.due_date || null,
      created_by: profile.id,
    });
    setSaving(false);
    if (err) { alert(err.message); return; }
    setModal(null);
    load();
  }

  async function togglePublish(a) {
    await supabase.from("assignments").update({ is_published: !a.is_published }).eq("id", a.id);
    load();
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this assignment? This cannot be undone.")) return;
    await supabase.from("assignments").delete().eq("id", id);
    load();
  }

  const visible = (canCreate
    ? assignments
    : assignments.filter((a) => a.is_published)
  ).filter((a) => filterCourse === "all" || a.course_id === filterCourse);

  return (
    <AppShell
      title="Assignments"
      subtitle={canCreate ? "Create and manage assignments and quizzes" : "View your assignments"}
    >
      <div className="dashboard-stack">
        <div className="page-header">
          <div className="field" style={{ margin: 0, minWidth: 220 }}>
            <select value={filterCourse} onChange={(e) => setFilterCourse(e.target.value)}>
              <option value="all">All Courses</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.code} – {c.name}</option>
              ))}
            </select>
          </div>
          {canCreate && <BtnPrimary onClick={openCreate}>+ New Assignment</BtnPrimary>}
        </div>

        {loading && <p className="text-muted">Loading assignments…</p>}

        {!loading && (
          <div className="content-card">
            <h2>Assignments &amp; Quizzes</h2>
            {visible.length === 0 ? (
              <p className="empty-state">
                No assignments found{filterCourse !== "all" ? " for this course" : ""}.
                {canCreate && " Create one above."}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Course</th>
                      <th>Type</th>
                      <th>Due Date</th>
                      <th>Status</th>
                      {canCreate && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((a) => (
                      <tr key={a.id}>
                        <td className="col-name">{a.title}</td>
                        <td><span className="code-badge">{a.courses?.code ?? "—"}</span></td>
                        <td>
                          <span className={a.type === "quiz" ? "chip chip-gold" : "chip chip-blue"}>
                            {a.type === "quiz" ? "Quiz" : "Assignment"}
                          </span>
                        </td>
                        <td className={isPast(a.due_date) && !a.is_published ? "text-danger" : ""}>
                          {formatDate(a.due_date)}
                        </td>
                        <td>
                          {!a.is_published ? (
                            <span className="chip chip-gray">Draft</span>
                          ) : isPast(a.due_date) ? (
                            <span className="chip chip-red">Closed</span>
                          ) : (
                            <span className="chip chip-green">Open</span>
                          )}
                        </td>
                        {canCreate && (
                          <td className="actions-cell">
                            <BtnGhost className="btn-xs" onClick={() => togglePublish(a)}>
                              {a.is_published ? "Unpublish" : "Publish"}
                            </BtnGhost>
                            <BtnGhost
                              className="btn-xs btn-ghost-danger"
                              onClick={() => handleDelete(a.id)}
                            >
                              Delete
                            </BtnGhost>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {modal === "create" && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">New Assignment</h2>
            <form className="auth-form" onSubmit={handleSave}>
              <div className="field">
                <span>Title</span>
                <input
                  required
                  placeholder="e.g. Week 3 Problem Set"
                  value={form.title}
                  onChange={(e) => field("title", e.target.value)}
                />
              </div>
              <div className="form-row-2">
                <div className="field">
                  <span>Type</span>
                  <select value={form.type} onChange={(e) => field("type", e.target.value)}>
                    <option value="assignment">Assignment</option>
                    <option value="quiz">Quiz</option>
                  </select>
                </div>
                <div className="field">
                  <span>Course</span>
                  <select
                    required
                    value={form.course_id}
                    onChange={(e) => field("course_id", e.target.value)}
                  >
                    <option value="">— Select course —</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>{c.code} – {c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <span>Due Date</span>
                <input
                  type="datetime-local"
                  value={form.due_date}
                  onChange={(e) => field("due_date", e.target.value)}
                />
              </div>
              <label className="field-checkbox">
                <input
                  type="checkbox"
                  checked={form.is_published}
                  onChange={(e) => field("is_published", e.target.checked)}
                />
                <span>Publish immediately</span>
              </label>
              <div className="modal-actions">
                <BtnGhost type="button" onClick={() => setModal(null)}>Cancel</BtnGhost>
                <BtnPrimary type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Create"}
                </BtnPrimary>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
