"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const navigation = [
  { href: "/today", label: "Today", index: "01" },
  { href: "/calendar", label: "Calendar", index: "02" },
  { href: "/courses", label: "Courses", index: "03" },
  { href: "/settings", label: "Settings", index: "04" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="masthead">
      <Link href="/today" className="wordmark" aria-label="Cortex home">Cortex<span>.</span></Link>
      <nav className="index-nav" aria-label="Primary navigation">
        {navigation.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
              <span>{item.index}</span>{item.label}
            </Link>
          );
        })}
      </nav>
      <button className="text-action" onClick={signOut}>Sign out</button>
    </header>
  );
}
