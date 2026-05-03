import { useEffect, useState, useCallback, useMemo } from "react";
import AppShell from "../../components/layout/AppShell";
import { BtnGhost } from "../../components/ui/Buttons";
import { supabase } from "../../lib/supabase";
import { roleChipClass, roleLabel } from "../../lib/roles";

const ROLE_FILTERS = [
  { value: "all",       label: "All" },
  { value: "professor", label: "Professors" },
  { value: "ta",        label: "TAs" },
];

export default function StaffDirectoryPage() {
  const [people,    setPeople]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [filter,    setFilter]    = useState("all");
  const [search,    setSearch]    = useState("");
  const [selected,  setSelected]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: err } = await supabase
      .from("profiles")
      .select(`
        id, full_name, email, role, avatar_url, is_removed,
        staff!profile_id ( title, department, office_hours, office_location )
      `)
      .in("role", ["professor", "ta"])
      .order("full_name");
    if (err) {
      setError(err.message);
      setPeople([]);
    } else {
      const mapped = (data || [])
        .filter((p) => !p.is_removed)
        .map((p) => {
          const s = Array.isArray(p.staff) ? p.staff[0] : p.staff;
          return {
            id:              p.id,
            full_name:       p.full_name,
            email:           p.email,
            role:            p.role,
            avatar_url:      p.avatar_url,
            title:           s?.title || null,
            department:      s?.department || null,
            office_hours:    s?.office_hours || null,
            office_location: s?.office_location || null,
          };
        });
      setPeople(mapped);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    all:       people.length,
    professor: people.filter((p) => p.role === "professor").length,
    ta:        people.filter((p) => p.role === "ta").length,
  }), [people]);

  const filtered = useMemo(() => {
    const base = filter === "all" ? people : people.filter((p) => p.role === filter);
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((p) =>
      (p.full_name || "").toLowerCase().includes(q) ||
      (p.email || "").toLowerCase().includes(q) ||
      (p.department || "").toLowerCase().includes(q) ||
      (p.title || "").toLowerCase().includes(q)
    );
  }, [people, filter, search]);

  function initials(name) {
    if (!name) return "?";
    return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
  }

  return (
    <AppShell title="Staff Directory">
      <div className="dashboard-stack">
        {loading && <p className="text-muted">Loading staff…</p>}
        {error   && <p className="error-msg">{error}</p>}

        {!loading && !error && (
          <div className="content-card">
            <div className="students-header">
              <h2>Professors & Teaching Assistants</h2>
            </div>

            <input
              className="search-input"
              placeholder="Search by name, email, department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginTop: 14, width: "100%", maxWidth: 320 }}
            />

            <div className="course-tabs" style={{ marginTop: 10 }}>
              {ROLE_FILTERS.map((f) => (
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
                {people.length === 0
                  ? "No staff available."
                  : "No staff match your filters."}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Title</th>
                      <th>Department</th>
                      <th>Email</th>
                      <th>Office</th>
                      <th>Office hours</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p.id}>
                        <td className="col-name">{p.full_name || "—"}</td>
                        <td>
                          <span className={`chip ${roleChipClass(p.role)}`}>
                            {roleLabel(p.role)}
                          </span>
                        </td>
                        <td>{p.title || <span className="text-muted">—</span>}</td>
                        <td>{p.department || <span className="text-muted">—</span>}</td>
                        <td>
                          {p.email
                            ? <a href={`mailto:${p.email}`} className="text-link">{p.email}</a>
                            : <span className="text-muted">—</span>}
                        </td>
                        <td>{p.office_location || <span className="text-muted">—</span>}</td>
                        <td>
                          {p.office_hours
                            ? p.office_hours
                            : <span className="text-muted">Not available</span>}
                        </td>
                        <td className="actions-cell">
                          <BtnGhost className="btn-xs" onClick={() => setSelected(p)}>
                            View
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

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
              <div
                style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: "var(--accent-soft)", color: "var(--accent)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, fontWeight: 600, flexShrink: 0,
                  backgroundImage: selected.avatar_url ? `url(${selected.avatar_url})` : undefined,
                  backgroundSize: "cover", backgroundPosition: "center",
                }}
                aria-hidden="true"
              >
                {!selected.avatar_url && initials(selected.full_name)}
              </div>
              <div>
                <h2 className="modal__title" style={{ margin: 0 }}>
                  {selected.full_name || "Unnamed"}
                </h2>
                <span className={`chip ${roleChipClass(selected.role)}`} style={{ marginTop: 4 }}>
                  {roleLabel(selected.role)}
                </span>
              </div>
            </div>

            <div
              style={{
                background: "var(--accent-soft)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "14px 16px",
                marginBottom: 14,
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--accent)",
                  marginBottom: 6,
                }}
              >
                Office hours
              </span>
              {selected.office_hours ? (
                <strong style={{ fontSize: 15, color: "var(--text)", whiteSpace: "pre-line" }}>
                  {selected.office_hours}
                </strong>
              ) : (
                <strong style={{ fontSize: 15, color: "var(--text-muted)", fontWeight: 500 }}>
                  Not available
                </strong>
              )}
            </div>

            <dl className="ta-meta-grid">
              <div className="ta-meta-item">
                <span>Title</span>
                <strong>{selected.title || "Not set"}</strong>
              </div>
              <div className="ta-meta-item">
                <span>Department</span>
                <strong>{selected.department || "Not set"}</strong>
              </div>
              <div className="ta-meta-item" style={{ gridColumn: "span 2", minWidth: 0 }}>
                <span>Email</span>
                <strong style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-all" }}>
                  {selected.email
                    ? <a href={`mailto:${selected.email}`} className="text-link">{selected.email}</a>
                    : "Not set"}
                </strong>
              </div>
              <div className="ta-meta-item">
                <span>Office location</span>
                <strong>{selected.office_location || "Not set"}</strong>
              </div>
            </dl>

            <div className="modal-actions">
              <BtnGhost onClick={() => setSelected(null)}>Close</BtnGhost>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
