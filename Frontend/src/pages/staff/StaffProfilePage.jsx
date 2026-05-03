import { useEffect, useState, useCallback } from "react";
import AppShell from "../../components/layout/AppShell";
import { BtnPrimary, BtnGhost } from "../../components/ui/Buttons";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";
import { roleChipClass, roleLabel } from "../../lib/roles";

const EMPTY_FORM = {
  fullName:       "",
  role:           "ta",
  title:          "",
  department:     "",
  officeHours:    "",
  officeLocation: "",
};

const ROLE_OPTIONS = [
  { value: "ta",        label: "Teaching Assistant (TA)" },
  { value: "professor", label: "Professor" },
  { value: "admin",     label: "Admin" },
];

export default function StaffProfilePage() {
  const { profile, refreshProfile } = useAuth();

  const [form,        setForm]        = useState(EMPTY_FORM);
  const [initial,     setInitial]     = useState(EMPTY_FORM);
  const [staffRowId,  setStaffRowId]  = useState(null);
  const [errors,      setErrors]      = useState({});
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState(null);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [success,     setSuccess]     = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true); setLoadError(null);

    const { data, error } = await supabase
      .from("staff")
      .select("id, title, department, office_hours, office_location")
      .eq("profile_id", profile.id)
      .maybeSingle();

    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }

    const next = {
      fullName:       profile.full_name || "",
      role:           profile.role || "ta",
      title:          data?.title || "",
      department:     data?.department || "",
      officeHours:    data?.office_hours || "",
      officeLocation: data?.office_location || "",
    };
    setForm(next);
    setInitial(next);
    setStaffRowId(data?.id || null);
    setLoading(false);
  }, [profile?.id, profile?.full_name]);

  useEffect(() => { load(); }, [load]);

  function field(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setSuccess(false);
  }

  function validate() {
    const errs = {};
    if (!form.fullName.trim()) errs.fullName = "Full name is required.";
    if (!ROLE_OPTIONS.some((o) => o.value === form.role)) {
      errs.role = "Please choose a valid role.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const isDirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError(""); setSuccess(false);
    if (!validate()) return;

    setSubmitting(true);

    const trimmed = {
      fullName:       form.fullName.trim(),
      role:           form.role,
      title:          form.title.trim(),
      department:     form.department.trim(),
      officeHours:    form.officeHours.trim(),
      officeLocation: form.officeLocation.trim(),
    };

    const { data: profileRows, error: profileErr } = await supabase
      .from("profiles")
      .update({ full_name: trimmed.fullName, role: trimmed.role })
      .eq("id", profile.id)
      .select("id");
    if (profileErr) { setSubmitError(profileErr.message); setSubmitting(false); return; }
    if (!profileRows || profileRows.length === 0) {
      setSubmitError("Your profile was not updated. This usually means a Row-Level Security policy is blocking the write.");
      setSubmitting(false); return;
    }

    const staffFields = {
      title:           trimmed.title          || null,
      department:      trimmed.department     || null,
      office_hours:    trimmed.officeHours    || null,
      office_location: trimmed.officeLocation || null,
    };

    if (staffRowId) {
      const { data: staffRows, error: staffErr } = await supabase
        .from("staff")
        .update(staffFields)
        .eq("id", staffRowId)
        .select("id");
      if (staffErr) { setSubmitError(staffErr.message); setSubmitting(false); return; }
      if (!staffRows || staffRows.length === 0) {
        setSubmitError("Your staff details were not updated. A Row-Level Security policy on the `staff` table is blocking the write — see the README/console.");
        setSubmitting(false); return;
      }
    } else {
      const { data: inserted, error: staffErr } = await supabase
        .from("staff")
        .insert({ profile_id: profile.id, ...staffFields })
        .select("id")
        .single();
      if (staffErr) { setSubmitError(staffErr.message); setSubmitting(false); return; }
      if (inserted?.id) setStaffRowId(inserted.id);
    }

    await refreshProfile();

    const next = {
      fullName:       trimmed.fullName,
      role:           trimmed.role,
      title:          trimmed.title,
      department:     trimmed.department,
      officeHours:    trimmed.officeHours,
      officeLocation: trimmed.officeLocation,
    };
    setInitial(next);
    setForm(next);
    setSubmitting(false);
    setSuccess(true);
  }

  function handleReset() {
    setForm(initial);
    setErrors({});
    setSubmitError("");
    setSuccess(false);
  }

  return (
    <AppShell title="My Profile">
      <div className="dashboard-stack">
        {loading && <p className="text-muted">Loading your profile…</p>}
        {loadError && <p className="error-msg">{loadError}</p>}

        {!loading && !loadError && (
          <div className="content-card">
            <div className="students-header">
              <div>
                <h2>Profile & office hours</h2>
                <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
                  Keep your contact details and office hours up to date so students and colleagues can reach you.
                </p>
              </div>
              <span className={`chip ${roleChipClass(profile?.role)}`}>
                {roleLabel(profile?.role)}
              </span>
            </div>

            {submitError && <p className="error-msg" style={{ marginTop: 14 }}>{submitError}</p>}
            {success && (
              <p className="form-banner" style={{ marginTop: 14 }}>
                Your profile has been updated. The new information is now visible across the system.
              </p>
            )}

            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <span>Email</span>
                <input value={profile?.email || ""} readOnly className="admission-readonly" />
                <small style={{ color: "var(--text-muted)" }}>
                  Contact an administrator to change your email address.
                </small>
              </div>

              <div className="field">
                <span>Full name <span className="text-danger" aria-hidden="true">*</span></span>
                <input
                  placeholder="e.g. Dr. Ahmed Mohamed"
                  value={form.fullName}
                  className={errors.fullName ? "has-error" : ""}
                  onChange={(e) => field("fullName", e.target.value)}
                />
                {errors.fullName && <small>{errors.fullName}</small>}
              </div>

              <div className="field">
                <span>Role <span className="text-danger" aria-hidden="true">*</span></span>
                <select
                  value={form.role}
                  className={errors.role ? "has-error" : ""}
                  onChange={(e) => field("role", e.target.value)}
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {errors.role
                  ? <small>{errors.role}</small>
                  : <small style={{ color: "var(--text-muted)" }}>
                      Changing your role updates your access level across the system.
                    </small>}
              </div>

              <div className="field">
                <span>Title</span>
                <input
                  placeholder="e.g. Associate Professor"
                  value={form.title}
                  onChange={(e) => field("title", e.target.value)}
                />
              </div>

              <div className="field">
                <span>Department</span>
                <input
                  placeholder="e.g. Computer Science"
                  value={form.department}
                  onChange={(e) => field("department", e.target.value)}
                />
              </div>

              <div className="field">
                <span>Office location</span>
                <input
                  placeholder="e.g. Building C, Room 312"
                  value={form.officeLocation}
                  onChange={(e) => field("officeLocation", e.target.value)}
                />
              </div>

              <div className="field">
                <span>Office hours</span>
                <textarea
                  rows={3}
                  placeholder={"e.g. Mon 10:00–12:00\nWed 14:00–16:00"}
                  value={form.officeHours}
                  onChange={(e) => field("officeHours", e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: 92,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--white)",
                    color: "var(--text)",
                    padding: "0.85rem 0.95rem",
                    outline: "none",
                    fontFamily: "inherit",
                    fontSize: 14,
                    resize: "vertical",
                  }}
                />
                <small style={{ color: "var(--text-muted)" }}>
                  Shown on your staff directory profile. Leave empty to display "Not available".
                </small>
              </div>

              <div className="modal-actions" style={{ marginTop: 6 }}>
                <BtnGhost type="button" disabled={submitting || !isDirty} onClick={handleReset}>
                  Discard changes
                </BtnGhost>
                <BtnPrimary type="submit" disabled={submitting || !isDirty}>
                  {submitting ? "Saving…" : "Save changes"}
                </BtnPrimary>
              </div>
            </form>
          </div>
        )}
      </div>
    </AppShell>
  );
}
