"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/assignments", label: "Assignments" },
  { href: "/courses", label: "Courses" },
  { href: "/calendar", label: "Calendar" },
  { href: "/statistics", label: "Statistics" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  // On-visit sync: cheap to call every mount — the API route itself
  // debounces so this doesn't spam the GitHub Actions workflow.
  useEffect(() => {
    fetch("/api/sync/trigger", { method: "POST" }).catch(() => {});
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-screen w-44 shrink-0 flex-col border-r border-border bg-bg px-3 py-4">
      <div className="mb-6 flex items-center gap-2 px-2">
        <span className="h-2 w-2 rounded-full bg-accent" />
        <span className="text-sm font-semibold tracking-tight text-text">cortex</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-bg-elevated text-text"
                  : "text-text-muted hover:bg-bg-hover hover:text-text"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border pt-2">
        <Link
          href="/settings"
          className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
            pathname.startsWith("/settings")
              ? "bg-bg-elevated text-text"
              : "text-text-muted hover:bg-bg-hover hover:text-text"
          }`}
        >
          Settings
        </Link>
        <button
          onClick={handleSignOut}
          className="rounded-md px-2.5 py-1.5 text-left text-sm text-text-muted hover:bg-bg-hover hover:text-text"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
