import type { Ctx } from "./engine.ts";
import { text } from "../_shared/moodle-values.ts";
/** Action events are paginated and user-filtered; even exhausting pages is not a deletion snapshot. */
export async function actionEvents(
  ctx: Ctx,
): Promise<Record<string, unknown>[]> {
  const events = new Map<string, Record<string, unknown>>();
  let aftereventid = "0";
  const timesortfrom = Math.floor(Date.now() / 1000) - 30 * 86400;
  for (let page = 0; page < 100; page++) {
    const result = await ctx.call<Record<string, unknown>>(
      ctx.baseUrl,
      ctx.token,
      "core_calendar_get_action_events_by_course",
      {
        courseid: ctx.scope_external_id,
        timesortfrom,
        aftereventid,
        limitnum: 50,
      },
    );
    if (!Array.isArray(result.events))
      throw new Error("Invalid action calendar response");
    const batch = result.events as Record<string, unknown>[];
    for (const event of batch) events.set(text(event.id), event);
    if (batch.length < 50) return [...events.values()];
    const next = text(result.lastid ?? batch.at(-1)?.id);
    if (!next || next === aftereventid)
      throw new Error("Action calendar cursor did not advance");
    aftereventid = next;
  }
  throw new Error(
    "Action calendar exceeded bounded pagination; scope remains incomplete",
  );
}
