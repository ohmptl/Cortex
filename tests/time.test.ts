import assert from "node:assert/strict";
import test from "node:test";
import { cortexDateKey, cortexDateTimeToUtc, formatCortexDateTime, startOfCortexDay } from "../src/lib/time.ts";

test("Cortex dates use America/New_York instead of the server timezone", () => {
  assert.equal(startOfCortexDay(new Date("2026-09-01T16:00:00Z")).toISOString(), "2026-09-01T04:00:00.000Z");
  assert.equal(cortexDateTimeToUtc(2026, 1, 15).toISOString(), "2026-01-15T05:00:00.000Z");
  assert.equal(cortexDateKey("2026-09-02T03:30:00Z"), "2026-09-01");
  assert.match(formatCortexDateTime("2026-09-02T03:30:00Z"), /Sep 1.+11:30 PM EDT/);
});
