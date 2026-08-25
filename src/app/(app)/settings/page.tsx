"use client";

import { useEffect, useState } from "react";
import { useGradescopeStore } from "@/store/gradescopeStore";
import { useMoodleStore } from "@/store/moodleStore";

export default function SettingsPage() {
  return (
    <div className="max-w-xl p-6">
      <h1 className="text-xl font-semibold text-text">Settings</h1>
      <div className="mt-6 flex flex-col gap-8">
        <GradescopeSection />
        <MoodleSection />
      </div>
    </div>
  );
}

function GradescopeSection() {
  const { connected, email, lastSync, isLoading, error, checkStatus, connect, disconnect } =
    useGradescopeStore();
  const [formEmail, setFormEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  async function handleSync() {
    await fetch("/api/sync/trigger", { method: "POST", body: JSON.stringify({ force: true }) });
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Gradescope</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            connected ? "bg-green/15 text-green" : "bg-bg-elevated text-text-muted"
          }`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {connected ? (
        <div className="rounded-lg border border-border bg-bg-elevated p-3 text-sm">
          <p className="text-text">{email}</p>
          <p className="text-xs text-text-faint">
            Last synced: {lastSync ? new Date(lastSync).toLocaleString() : "never"}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleSync}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white"
            >
              Sync now
            </button>
            <button
              onClick={disconnect}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:text-red"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            connect(formEmail, password);
          }}
          className="flex flex-col gap-2"
        >
          <input
            value={formEmail}
            onChange={(e) => setFormEmail(e.target.value)}
            placeholder="Gradescope email"
            className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
          />
          {error && <p className="text-xs text-red">{error}</p>}
          <button
            type="submit"
            disabled={isLoading}
            className="self-start rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            {isLoading ? "Connecting…" : "Connect"}
          </button>
        </form>
      )}
    </section>
  );
}

function MoodleSection() {
  const { connected, url, username, lastSync, isLoading, error, checkStatus, connect, disconnect } =
    useMoodleStore();
  const [formUrl, setFormUrl] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  async function handleSync() {
    await fetch("/api/sync/trigger", { method: "POST", body: JSON.stringify({ force: true }) });
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Moodle</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            connected ? "bg-green/15 text-green" : "bg-bg-elevated text-text-muted"
          }`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {connected ? (
        <div className="rounded-lg border border-border bg-bg-elevated p-3 text-sm">
          <p className="text-text">
            {username}@{url}
          </p>
          <p className="text-xs text-text-faint">
            Last synced: {lastSync ? new Date(lastSync).toLocaleString() : "never"}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleSync}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white"
            >
              Sync now
            </button>
            <button
              onClick={disconnect}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:text-red"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            connect({ url: formUrl, username: formUsername, password: formPassword });
          }}
          className="flex flex-col gap-2"
        >
          <input
            value={formUrl}
            onChange={(e) => setFormUrl(e.target.value)}
            placeholder="https://moodle.your-school.edu"
            className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
          />
          <input
            value={formUsername}
            onChange={(e) => setFormUsername(e.target.value)}
            placeholder="Username"
            className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
          />
          <input
            type="password"
            value={formPassword}
            onChange={(e) => setFormPassword(e.target.value)}
            placeholder="Password"
            className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
          />
          {error && <p className="text-xs text-red">{error}</p>}
          <button
            type="submit"
            disabled={isLoading}
            className="self-start rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            {isLoading ? "Connecting…" : "Connect"}
          </button>
        </form>
      )}
    </section>
  );
}
