"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const { error: signInError } = await createClient().auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
    const requested = new URLSearchParams(window.location.search).get("redirect");
    router.replace(requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/today");
    router.refresh();
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <p className="eyebrow">Personal academic index</p>
        <h1>Cortex<span>.</span></h1>
        <p className="dek">One private record for courses, work, grades, and context.</p>
        <form onSubmit={submit} className="editorial-form">
          <label>Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" disabled={loading}>{loading ? "Signing in…" : "Enter Cortex"}<span>→</span></button>
        </form>
      </section>
    </main>
  );
}
