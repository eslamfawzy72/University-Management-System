import { Link, useNavigate } from "react-router-dom";

import { BtnPrimary } from "../components/ui/Buttons";
import { useAuth } from "../hooks/useAuth";
import { roleDashboardPath } from "../lib/roles";

export default function AccessDenied({ message = "Access denied." }) {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  const handleBack = async () => {
    if (profile?.role) {
      navigate(roleDashboardPath(profile.role), { replace: true });
      return;
    }

    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <section className="access-denied">
      <article className="access-denied__card">
        <p className="eyebrow">UniSystem security</p>
        <h1>{message}</h1>
        <p>
          Your current account does not have permission to open this page. Return to your
          allowed dashboard or sign in again with a different account.
        </p>

        <div className="access-denied__actions">
          <BtnPrimary onClick={handleBack}>Go to my dashboard</BtnPrimary>
          <Link className="text-link" to="/login">
            Back to login
          </Link>
        </div>
      </article>
    </section>
  );
}
