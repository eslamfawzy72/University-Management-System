import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

function normalizeAuthError(error) {
  const message = error?.message?.toLowerCase() ?? "";

  if (
    message.includes("invalid login credentials") ||
    message.includes("invalid credentials") ||
    message.includes("wrong email or password")
  ) {
    return new Error("Invalid email or password");
  }

  if (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    error?.name === "AuthRetryableFetchError"
  ) {
    return new Error("Something went wrong");
  }

  return new Error(error?.message || "Something went wrong");
}

async function readProfile(userId) {
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Profile read timeout")), 5000)
    );

    const profilePromise = supabase
      .from("profiles")
      .select("id, role, full_name, email, avatar_url")
      .eq("id", userId)
      .maybeSingle();

    const { data, error } = await Promise.race([profilePromise, timeoutPromise]);

    if (error) {
      console.error("Profile read error:", error);
      throw normalizeAuthError(error);
    }

    console.log("Profile loaded:", data);
    return data ?? null;
  } catch (err) {
    console.error("readProfile exception:", err);
    throw err;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const syncSession = async (nextSession) => {
    setSession(nextSession ?? null);

    if (!nextSession?.user) {
      setProfile(null);
      setLoading(false);
      return null;
    }

    const nextProfile = await readProfile(nextSession.user.id);

    if (!nextProfile?.role) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      setLoading(false);
      throw new Error("Access denied: role is missing");
    }

    setProfile(nextProfile);
    setLoading(false);
    return nextProfile;
  };

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      setLoading(true);
      const {
        data: { session: currentSession },
        error,
      } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      if (error) {
        setSession(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      if (!currentSession?.user) {
        setSession(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        await syncSession(currentSession);
      } catch (authError) {
        setSession(null);
        setProfile(null);
        setLoading(false);
        console.error(authError);
      }
    };

    bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!active) {
        return;
      }

      setLoading(true);

      try {
        await syncSession(nextSession);
      } catch (authError) {
        setSession(null);
        setProfile(null);
        setLoading(false);
        console.error(authError);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async ({ email, password }) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      const nextProfile = await syncSession(data.session);

      if (!nextProfile?.role) {
        throw new Error("Access denied: role is missing");
      }

      return nextProfile;
    } catch (error) {
      setSession(null);
      setProfile(null);
      setLoading(false);
      throw normalizeAuthError(error);
    }
  };

  const signUp = async ({ fullName, role, email, password }) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role,
          },
        },
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        const nextProfile = await syncSession(data.session);
        return nextProfile;
      }

      return null;
    } catch (error) {
      setSession(null);
      setProfile(null);
      setLoading(false);
      throw normalizeAuthError(error);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      signIn,
      signUp,
      signOut,
    }),
    [loading, profile, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuthContext must be used inside AuthProvider");
  }

  return context;
}
