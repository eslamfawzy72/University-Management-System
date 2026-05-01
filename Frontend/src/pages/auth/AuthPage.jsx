import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { BtnPrimary, BtnGhost } from "../../components/ui/Buttons";
import { useAuth } from "../../hooks/useAuth";
import { roleDashboardPath, roleChipClass } from "../../lib/roles";
import { supabase } from "../../lib/supabase";

const INITIAL_VALUES = {
  fullName: "",
  email: "",
  password: "",
  role: "student",
};

function validate(mode, values) {
  const errors = {};

  if (mode === "signup" && !values.fullName.trim()) {
    errors.fullName = "Full name is required";
  }

  if (!values.email.trim()) {
    errors.email = "Email is required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = "Enter a valid email address";
  }

  if (!values.password) {
    errors.password = "Password is required";
  } else if (values.password.length < 6) {
    errors.password = "Password must be at least 6 characters";
  }

  if (mode === "signup" && !values.role) {
    errors.role = "Role is required";
  }

  return errors;
}

export default function AuthPage({ mode }) {
  const isSignup = mode === "signup";
  const navigate = useNavigate();
  const { session, profile, loading, signIn, signUp } = useAuth();
  const [values,           setValues]           = useState(INITIAL_VALUES);
  const [errors,           setErrors]           = useState({});
  const [statusMessage,    setStatusMessage]    = useState("");
  const [submitting,       setSubmitting]       = useState(false);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState("");
  const [resending,        setResending]        = useState(false);
  const [resendDone,       setResendDone]       = useState(false);

  useEffect(() => {
    if (session && profile?.role) {
      navigate(roleDashboardPath(profile.role), { replace: true });
    }
  }, [navigate, profile?.role, session]);

  const formTitle = isSignup ? "Create your UniSystem account" : "Log in to UniSystem";
  const formSubtitle = isSignup
    ? "Choose your role once and we will route you to the right dashboard."
    : "Use your email and password to open your personal dashboard.";

  const roleOptions = useMemo(
    () => [
      { value: "student", label: "Student" },
      { value: "parent", label: "Parent" }
    ],
    []
  );

  const updateField = (field) => (event) => {
    const nextValue = event.target.value;
    setValues((current) => ({ ...current, [field]: nextValue }));

    if (errors[field]) {
      setErrors((current) => {
        const nextErrors = { ...current };
        delete nextErrors[field];
        return nextErrors;
      });
    }

    // Clear the unconfirmed banner if the user edits the email field
    if (field === "email") {
      setUnconfirmedEmail("");
      setResendDone(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    await supabase.auth.resend({ type: "signup", email: unconfirmedEmail });
    setResending(false);
    setResendDone(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatusMessage("");
    setUnconfirmedEmail("");
    setResendDone(false);

    const nextErrors = validate(mode, values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);

    try {
      if (isSignup) {
        const nextProfile = await signUp({
          fullName: values.fullName.trim(),
          role: values.role,
          email: values.email.trim(),
          password: values.password,
        });

        if (nextProfile?.role) {
          navigate(roleDashboardPath(nextProfile.role), { replace: true });
          return;
        }

        setStatusMessage("Account created. Check your email to finish verification.");
        setValues(INITIAL_VALUES);
        return;
      }

      const nextProfile = await signIn({
        email: values.email.trim(),
        password: values.password,
      });

      navigate(roleDashboardPath(nextProfile.role), { replace: true });
    } catch (error) {
      const msg = error.message?.toLowerCase() ?? "";
      if (msg.includes("not confirmed")) {
        // Old Supabase: explicit "Email not confirmed" error
        setUnconfirmedEmail(values.email.trim());
      } else if (!isSignup) {
        // Supabase v2 returns "invalid login credentials" for BOTH wrong password
        // and unconfirmed email — always surface the resend option on login failures
        setStatusMessage(error.message || "Something went wrong");
        setUnconfirmedEmail(values.email.trim());
      } else {
        setStatusMessage(error.message || "Something went wrong");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="auth-page">
      <div className="auth-page__glow auth-page__glow--one" />
      <div className="auth-page__glow auth-page__glow--two" />

      <div className="auth-layout">
        <aside className="auth-hero">
          <p className="eyebrow">UniSystem access</p>
          <h1>University workspaces built around role-based access.</h1>
          <p>
            Students, parents, professors, and TAs get a fast login flow that sends them to
            the right dashboard the moment Supabase confirms their profile role.
          </p>

          <div className="auth-role-list">
            {roleOptions.map((option) => (
              <span key={option.value} className={`chip ${roleChipClass(option.value)}`}>
                {option.label}
              </span>
            ))}
          </div>

          <div className="auth-note-card">
            <strong>Session aware</strong>
            <p>
              Valid credentials sign you in, missing roles are denied, and invalid logins show
              a clear error message.
            </p>
          </div>
        </aside>

        <article className="auth-card">
          <div className="auth-card__header">
            <div>
              <p className="eyebrow">{isSignup ? "New account" : "Existing account"}</p>
              <h2>{formTitle}</h2>
              <p>{formSubtitle}</p>
            </div>

            <div className="auth-switch">
              <Link className={isSignup ? "" : "is-active"} to="/login">
                Login
              </Link>
              <Link className={isSignup ? "is-active" : ""} to="/signup">
                Signup
              </Link>
            </div>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            {isSignup ? (
              <label className="field">
                <span>Full name</span>
                <input
                  className={errors.fullName ? "has-error" : ""}
                  type="text"
                  value={values.fullName}
                  onChange={updateField("fullName")}
                  autoComplete="name"
                  placeholder="Ahmed Hassan"
                />
                {errors.fullName ? <small>{errors.fullName}</small> : null}
              </label>
            ) : null}

            <label className="field">
              <span>Email</span>
              <input
                className={errors.email ? "has-error" : ""}
                type="email"
                value={values.email}
                onChange={updateField("email")}
                autoComplete="email"
                placeholder="you@example.com"
              />
              {errors.email ? <small>{errors.email}</small> : null}
            </label>

            <label className="field">
              <span>Password</span>
              <input
                className={errors.password ? "has-error" : ""}
                type="password"
                value={values.password}
                onChange={updateField("password")}
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder="••••••••"
              />
              {errors.password ? <small>{errors.password}</small> : null}
            </label>

            {isSignup ? (
              <label className="field">
                <span>Role</span>
                <select
                  className={errors.role ? "has-error" : ""}
                  value={values.role}
                  onChange={updateField("role")}
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {errors.role ? <small>{errors.role}</small> : null}
              </label>
            ) : null}

            {statusMessage && !unconfirmedEmail
              ? <div className="form-banner">{statusMessage}</div>
              : null}

            {unconfirmedEmail && !resendDone && (
              <div className="form-banner form-banner--warn">
                <p style={{ marginBottom: 10 }}>
                  {statusMessage
                    ? <><strong>Login failed.</strong> {statusMessage}. If your account was
                        just added by an admin, you also need to confirm your email before
                        your first login — check your inbox for the confirmation link.</>
                    : <><strong>Email not verified.</strong> Please check your inbox and click
                        the confirmation link before logging in.</>}
                </p>
                <BtnGhost type="button" disabled={resending} onClick={handleResend}>
                  {resending ? "Sending…" : "Resend confirmation email"}
                </BtnGhost>
              </div>
            )}

            {resendDone && (
              <div className="form-banner">
                Confirmation email sent. Check your inbox and click the link, then log in.
              </div>
            )}

            <BtnPrimary type="submit" className="auth-submit" disabled={submitting}>
              {submitting ? "Please wait..." : isSignup ? "Create account" : "Log in"}
            </BtnPrimary>

            <div className="auth-footer">
              <p>
                {isSignup ? "Already registered?" : "Need an account?"}{" "}
                <Link to={isSignup ? "/login" : "/signup"}>
                  {isSignup ? "Back to login" : "Create one"}
                </Link>
              </p>

              {!isSignup ? (
                <BtnGhost type="button" onClick={() => setValues(INITIAL_VALUES)}>
                  Reset form
                </BtnGhost>
              ) : null}
            </div>
          </form>
        </article>
      </div>
    </section>
  );
}
