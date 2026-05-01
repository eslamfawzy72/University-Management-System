import { useState, useEffect } from "react";
import { useAuth } from "./useAuth";
import { useRole } from "./useRole";
import { supabase } from "../lib/supabase";

/**
 * A student is considered enrolled only when their admission application
 * has been explicitly approved (status = 'approved').
 * Non-students always resolve to enrolled=true instantly.
 *
 * enrolled: true  → approved student (or non-student role)
 * enrolled: false → no application or application not yet approved
 * enrolled: null  → still loading (student role only)
 */
export function useEnrollment() {
  const { profile } = useAuth();
  const { role } = useRole();
  const [enrolled, setEnrolled] = useState(null);

  useEffect(() => {
    if (role !== "student") {
      setEnrolled(true);
      return;
    }
    if (!profile?.id) return;

    let active = true;
    supabase
      .from("admission_applications")
      .select("status")
      .eq("applicant_id", profile.id)
      .eq("status", "approved")
      .maybeSingle()
      .then(({ data }) => {
        if (active) setEnrolled(!!data);
      });

    return () => { active = false; };
  }, [role, profile?.id]);

  return {
    enrolled,
    loading: role === "student" && enrolled === null && !!profile?.id,
  };
}
