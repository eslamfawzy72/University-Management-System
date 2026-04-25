# README.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Agile course project with two top-level workspaces:

- `Frontend/` — Vite + React 19 (JavaScript, **not** TypeScript) frontend. All commands below run from this directory.
- `Backend/` — empty. Supabase is the backend; this folder is reserved for any future server-side code (e.g. Edge Functions, scripts).

The repo root has no package.json or build system of its own.

## Stack decisions

- Frontend: **Vite + React + plain JS** (no TypeScript, no Next.js). The user explicitly chose this over Next.js because Supabase serves the backend role and they don't need SSR/server features.
- Backend: **Supabase** (project `khnixybbgsifxojljeia`). Frontend talks to it directly using the anon key.

## Commands (run from `Frontend/`)

- `npm run dev` — Vite dev server (default http://localhost:5173)
- `npm run build` — production build to `Frontend/dist/`
- `npm run preview` — serve the built `dist/` locally
- `npm run lint` — ESLint over the project

No test runner is configured.

## Supabase wiring

- Env vars live in `Frontend/.env.local` and **must** be prefixed with `VITE_` for Vite to expose them to client code (accessed via `import.meta.env.VITE_*`, not `process.env`).
- Required vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Template in `Frontend/.env.example`.
- A shared client lives at `Frontend/src/lib/supabase.js`. Import with `import { supabase } from "./lib/supabase"` (adjust relative path) and call `supabase.from("...").select(...)` etc.
- The anon key is safe to ship to the browser **only if** Row Level Security is properly configured on every table in Supabase. Treat RLS as a hard requirement before adding any sensitive table.

## Secrets / .gitignore

- Both the root `.gitignore` and `Frontend/.gitignore` exclude `.env*` (with `.env.example` whitelisted). Never commit a real Supabase key.
- If a key ever lands in git history, rotate it in the Supabase dashboard — the anon key currently in `.env.local` is already exposed in the local `.env` history of this working copy.
