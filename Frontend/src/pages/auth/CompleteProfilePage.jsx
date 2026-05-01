import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";
import { roleDashboardPath } from "../../lib/roles";
import { BtnPrimary } from "../../components/ui/Buttons";

export default function CompleteProfilePage() {
  const { session, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [fullName,        setFullName]        = useState(profile?.full_name || "");
  const [newPassword,     setNewPassword]     = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors,          setErrors]          = useState({});
  const [submitting,      setSubmitting]      = useState(false);
  const [error,           setError]           = useState("");

  function validate() {
    const errs = {};
    if (!fullName.trim())                       errs.fullName        = "Full name is required.";
    if (!newPassword)                           errs.newPassword     = "Password is required.";
    else if (newPassword.length < 8)            errs.newPassword     = "Password must be at least 8 characters.";
    if (newPassword !== confirmPassword)        errs.confirmPassword = "Passwords do not match.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function field(setter, key) {
    return (e) => {
      setter(e.target.value);
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setError("");

    // Change auth password
    const { error: passErr } = await supabase.auth.updateUser({ password: newPassword });
    if (passErr) { setError(passErr.message); setSubmitting(false); return; }

    // Update profile: name + clear the flag
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim(), must_change_password: false })
      .eq("id", session.user.id);
    if (profileErr) { setError(profileErr.message); setSubmitting(false); return; }

    // Refresh context so RequireSession no longer redirects here
    const updated = await refreshProfile();

    navigate(roleDashboardPath(updated?.role ?? "student"), { replace: true });
  }

  return (
    <section className="fullscreen-state">
      <div className="fullscreen-state__aurora fullscreen-state__aurora--blue" />
      <div className="fullscreen-state__aurora fullscreen-state__aurora--gold" />

      <div className="fullscreen-state__card complete-profile-card">
        <p className="eyebrow">UniSystem</p>
        <h1>Complete your profile</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14, margin: "6px 0 24px" }}>
          Set your full name and choose a permanent password before continuing.
        </p>

        {error && <p className="error-msg">{error}</p>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field">
            <span>Email</span>
            <input value={session?.user?.email || ""} readOnly className="admission-readonly" />
          </div>

          <div className="field">
            <span>Full Name <span className="text-danger" aria-hidden="true">*</span></span>
            <input
              placeholder="Your full name"
              value={fullName}
              className={errors.fullName ? "has-error" : ""}
              onChange={field(setFullName, "fullName")}
            />
            {errors.fullName && <small>{errors.fullName}</small>}
          </div>

          <div className="field">
            <span>New Password <span className="text-danger" aria-hidden="true">*</span></span>
            <input
              type="password"
              placeholder="At least 8 characters"
              value={newPassword}
              className={errors.newPassword ? "has-error" : ""}
              onChange={field(setNewPassword, "newPassword")}
            />
            {errors.newPassword && <small>{errors.newPassword}</small>}
          </div>

          <div className="field">
            <span>Confirm Password <span className="text-danger" aria-hidden="true">*</span></span>
            <input
              type="password"
              placeholder="Repeat your new password"
              value={confirmPassword}
              className={errors.confirmPassword ? "has-error" : ""}
              onChange={field(setConfirmPassword, "confirmPassword")}
            />
            {errors.confirmPassword && <small>{errors.confirmPassword}</small>}
          </div>

          <BtnPrimary type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Complete Setup"}
          </BtnPrimary>
        </form>
      </div>
    </section>
  );
}
