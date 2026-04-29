import { useState, useEffect, useCallback } from "react";
import AppShell from "../../components/layout/AppShell";
import { BtnPrimary, BtnGhost } from "../../components/ui/Buttons";
import { useRole } from "../../hooks/useRole";
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
  const { is } = useRole();
  const canManage = is("admin");

  const [courses, setCourses] = useState([]);
  const [departments, setDepartments] = useState([]);
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
    if (cErr || dErr) {
      setError((cErr || dErr).message);
    } else {
      setCourses(c || []);
      setDepartments(d || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setModal("form");
  }

  function openEdit(course) {
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

  return (
    <AppShell title="Courses" subtitle="Browse and manage the course catalog">
      <div className="dashboard-stack">
        {canManage && (
          <div className="page-header">
            <BtnPrimary onClick={openCreate}>+ New Course</BtnPrimary>
          </div>
        )}

        {loading && <p className="text-muted">Loading courses…</p>}
        {error && <p className="error-msg">{error}</p>}

        {!loading && !error && (
          <div className="content-card">
            <h2>Course Catalog</h2>
            {courses.length === 0 ? (
              <p className="empty-state">
                No courses found.{canManage && " Create your first course above."}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Department</th>
                      <th>Capacity</th>
                      <th>Status</th>
                      {canManage && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((c) => (
                      <tr key={c.id}>
                        <td><span className="code-badge">{c.code}</span></td>
                        <td className="col-name">{c.name}</td>
                        <td>
                          <span className={c.type === "core" ? "chip chip-blue" : "chip chip-gold"}>
                            {c.type === "core" ? "Core" : "Elective"}
                          </span>
                        </td>
                        <td>{c.departments?.name || "—"}</td>
                        <td>{c.capacity ?? "—"}</td>
                        <td>
                          <span className={c.is_active ? "chip chip-green" : "chip chip-gray"}>
                            {c.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        {canManage && (
                          <td className="actions-cell">
                            <BtnGhost className="btn-xs" onClick={() => openEdit(c)}>Edit</BtnGhost>
                            <BtnGhost
                              className="btn-xs btn-ghost-danger"
                              onClick={() => { setDeleteId(c.id); setModal("delete"); }}
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

      {modal === "form" && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">{editingId ? "Edit Course" : "New Course"}</h2>
            <form className="auth-form" onSubmit={handleSave}>
              <div className="form-row-2">
                <div className="field">
                  <span>Course Code</span>
                  <input
                    required
                    placeholder="e.g. CS101"
                    value={form.code}
                    onChange={(e) => field("code", e.target.value)}
                  />
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
                <input
                  required
                  placeholder="e.g. Introduction to Computer Science"
                  value={form.name}
                  onChange={(e) => field("name", e.target.value)}
                />
              </div>
              <div className="field">
                <span>Description</span>
                <textarea
                  rows={3}
                  placeholder="Course description…"
                  value={form.description}
                  onChange={(e) => field("description", e.target.value)}
                />
              </div>
              <div className="form-row-2">
                <div className="field">
                  <span>Department</span>
                  <select value={form.department_id} onChange={(e) => field("department_id", e.target.value)}>
                    <option value="">— None —</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <span>Capacity</span>
                  <input
                    type="number"
                    min="1"
                    placeholder="e.g. 30"
                    value={form.capacity}
                    onChange={(e) => field("capacity", e.target.value)}
                  />
                </div>
              </div>
              <label className="field-checkbox">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => field("is_active", e.target.checked)}
                />
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
            <p className="modal__body">
              This will permanently remove the course and cannot be undone.
            </p>
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
