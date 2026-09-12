// Minimal PostgREST adapter: executes worker writes and real reconciliation RPCs
// against PostgreSQL (PGlite), rather than mocking their reconciliation behavior.
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
const ident = (value: string) => '"' + value.replaceAll('"', '""') + '"';
export function databaseClient(db: PGlite): SupabaseClient {
  return {
    from(table: string) {
      let operation = "select",
        values: Record<string, unknown>[] = [];
      const filters: Array<[string, string, unknown]> = [];
      let conflict: string | undefined,
        ignore = false,
        single = false;
      const query = {
        select() {
          return query;
        },
        insert(input: Record<string, unknown> | Record<string, unknown>[]) {
          operation = "insert";
          values = Array.isArray(input) ? input : [input];
          return query;
        },
        upsert(
          input: Record<string, unknown> | Record<string, unknown>[],
          options?: { onConflict?: string; ignoreDuplicates?: boolean },
        ) {
          operation = "insert";
          values = Array.isArray(input) ? input : [input];
          conflict = options?.onConflict;
          ignore = options?.ignoreDuplicates ?? false;
          return query;
        },
        update(input: Record<string, unknown>) {
          operation = "update";
          values = [input];
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push([column, "=", value]);
          return query;
        },
        is(column: string, value: unknown) {
          filters.push([column, "is", value]);
          return query;
        },
        in(column: string, value: unknown[]) {
          filters.push([column, "in", value]);
          return query;
        },
        single() {
          single = true;
          return query;
        },
        maybeSingle() {
          single = true;
          return query;
        },
        async then(resolve: (result: unknown) => void) {
          try {
            const params: unknown[] = [];
            const param = (v: unknown) => {
              params.push(
                typeof v === "object" && v !== null ? JSON.stringify(v) : v,
              );
              return "$" + params.length;
            };
            let sql = "";
            if (operation === "select") sql = `select * from ${ident(table)}`;
            else if (operation === "update")
              sql =
                `update ${ident(table)} set ` +
                Object.entries(values[0])
                  .map(([k, v]) => `${ident(k)}=${param(v)}`)
                  .join(",");
            else {
              const keys = Object.keys(values[0]);
              sql =
                `insert into ${ident(table)} (${keys.map(ident).join(",")}) values ` +
                values
                  .map(
                    (row) =>
                      "(" +
                      keys.map((k) => param(row[k] ?? null)).join(",") +
                      ")",
                  )
                  .join(",");
              if (conflict)
                sql +=
                  ` on conflict (${conflict.split(",").map(ident).join(",")}) ` +
                  (ignore
                    ? "do nothing"
                    : "do update set " +
                      keys
                        .map((k) => `${ident(k)}=excluded.${ident(k)}`)
                        .join(","));
            }
            if (filters.length)
              sql +=
                " where " +
                filters
                  .map(([col, op, v]) =>
                    op === "is"
                      ? `${ident(col)} is null`
                      : op === "in"
                        ? `${ident(col)} in (${(v as unknown[]).map(param).join(",")})`
                        : `${ident(col)}=${param(v)}`,
                  )
                  .join(" and ");
            if (operation !== "select") sql += " returning *";
            const result = await db.query(sql, params);
            resolve({
              data: single ? (result.rows[0] ?? null) : result.rows,
              error: null,
            });
          } catch (error) {
            resolve({ data: null, error });
          }
        },
      };
      return query;
    },
    async rpc(fn: string, params: Record<string, unknown> = {}) {
      try {
        const keys = Object.keys(params);
        const result = await db.query<{ value: unknown }>(
          `select ${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(",")}) value`,
          Object.values(params),
        );
        return { data: result.rows[0]?.value, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  } as unknown as SupabaseClient;
}
