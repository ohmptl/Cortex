import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";

export async function moodleDatabase(through = "999") {
  const db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;`);
  for (const file of (await readdir("supabase/migrations"))
    .sort()
    .filter((f) => f.endsWith(".sql") && f < through)) {
    // PGlite provides gen_random_uuid in core; production also installs pgcrypto.
    const sql = (await readFile(`supabase/migrations/${file}`, "utf8")).replace(
      "create extension if not exists pgcrypto;",
      "",
    );
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file}: ${String(error)}`);
    }
  }
  return db;
}
export const OWNER = "00000000-0000-4000-8000-000000000001";
export async function seedConnection(db: PGlite) {
  await db.query("insert into auth.users(id) values($1)", [OWNER]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    OWNER,
  ]);
  return (
    await db.query<{ id: string }>(
      `insert into provider_connections(owner_id,provider,instance_key,base_url,external_user_id)
    values($1,'moodle','https://moodle.test','https://moodle.test','42') returning id`,
      [OWNER],
    )
  ).rows[0].id;
}
