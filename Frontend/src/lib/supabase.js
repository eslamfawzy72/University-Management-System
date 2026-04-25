import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in Frontend/.env.local"
  );
}
else{
  console.log("Supabase URL and anon key loaded successfully.");
}


export const supabase = createClient(url, anonKey);
