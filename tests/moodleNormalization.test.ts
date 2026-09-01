import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  emptyProjectionState,
  projectMoodleSnapshot,
  type MoodleSnapshot,
} from "../src/providers/moodle/normalizer.ts";
import { buildCapabilityDiagnostics } from "../src/providers/moodle/capabilities.ts";
import { sanitizeMoodlePayload } from "../src/providers/moodle/sanitize.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/moodle/snapshot.json", import.meta.url), "utf8")) as MoodleSnapshot;

test("Moodle courses are created automatically and remain stable on repeat sync", async () => {
  const first = await projectMoodleSnapshot(emptyProjectionState(), fixture);
  const second = await projectMoodleSnapshot(first.state, fixture);
  assert.equal(Object.keys(first.state.courses).length, 2);
  assert.equal(Object.keys(second.state.courses).length, 2);
  assert.equal(second.state.courses["101"].id, first.state.courses["101"].id);
});

test("items retain authoritative course and activity type", async () => {
  const { state } = await projectMoodleSnapshot(emptyProjectionState(), fixture);
  assert.equal(state.items["activity:assign:9001"].externalCourseId, "101");
  assert.equal(state.items["activity:assign:9001"].type, "assignment");
  assert.equal(state.items["activity:quiz:9002"].type, "quiz");
  assert.equal(state.items["calendar-event:7003"].type, "event");
});

test("upstream deadline changes update the same item and preserve overrides", async () => {
  const first = await projectMoodleSnapshot(emptyProjectionState(), fixture);
  first.state.items["activity:assign:9001"].overrides = { due_at: "2026-09-11T20:00:00.000Z" };
  const changed = structuredClone(fixture);
  const assignment = changed.assignments?.[0];
  if (!assignment) throw new Error("fixture assignment missing");
  assignment.duedate = 1789272000;
  const second = await projectMoodleSnapshot(first.state, changed);
  assert.equal(second.state.items["activity:assign:9001"].id, first.state.items["activity:assign:9001"].id);
  assert.notEqual(second.state.items["activity:assign:9001"].sourceDueAt, first.state.items["activity:assign:9001"].sourceDueAt);
  assert.deepEqual(second.state.items["activity:assign:9001"].overrides, { due_at: "2026-09-11T20:00:00.000Z" });
});

test("identical payloads create neither duplicate items nor raw versions", async () => {
  const first = await projectMoodleSnapshot(emptyProjectionState(), fixture);
  const second = await projectMoodleSnapshot(first.state, fixture);
  assert.equal(Object.keys(second.state.items).length, 3);
  assert.equal(second.state.raw["calendar-event:7001"].versions.length, 1);
  assert.ok(second.counters.unchanged > 0);
});

test("grade items retain their course and authoritative category", async () => {
  const { state } = await projectMoodleSnapshot(emptyProjectionState(), fixture);
  const grade = state.gradeItems["101:3002"];
  assert.equal(grade.externalCourseId, "101");
  assert.equal(grade.categoryExternalId, "3001");
  assert.equal(state.gradeCategories["101:3001"].externalCourseId, "101");
});

test("raw payload and item provenance are retained without credentials", async () => {
  const { state } = await projectMoodleSnapshot(emptyProjectionState(), fixture);
  const item = state.items["activity:assign:9001"];
  assert.equal(item.rawExternalId, "7001");
  assert.equal(state.raw[`calendar-event:${item.rawExternalId}`].objectType, "calendar-event");
  const sanitized = sanitizeMoodlePayload({ token: "secret", nested: { wstoken: "secret" }, title: "safe" });
  assert.deepEqual(sanitized, { token: "[redacted]", nested: { wstoken: "[redacted]" }, title: "safe" });
});

test("upstream disappearance is marked only after a complete scope", async () => {
  const first = await projectMoodleSnapshot(emptyProjectionState(), fixture);
  const partial = structuredClone(fixture);
  partial.events = partial.events?.slice(1);
  partial.completeScopes = partial.completeScopes?.filter((scope) => scope !== "events");
  const partialResult = await projectMoodleSnapshot(first.state, partial);
  assert.equal(partialResult.state.items["activity:assign:9001"].upstreamState, "present");
  partial.completeScopes = [...(partial.completeScopes ?? []), "events"];
  const completeResult = await projectMoodleSnapshot(first.state, partial);
  assert.equal(completeResult.state.items["activity:assign:9001"].upstreamState, "missing");
  assert.equal(completeResult.counters.missing, 1);
});

test("unsupported and failed optional capabilities remain diagnostic and non-fatal", async () => {
  const snapshot = structuredClone(fixture);
  snapshot.failures = [{ capability: "mod_assign_get_submission_status", message: "not available for this token" }];
  const result = await projectMoodleSnapshot(emptyProjectionState(), snapshot);
  assert.equal(Object.keys(result.state.courses).length, 2);
  assert.equal(result.counters.skipped, 1);
  assert.equal(result.counters.failed, 1);
  assert.ok(result.diagnostics.some((entry) => entry.includes("submission_status")));
});

test("capability diagnostics include discovered and desired-but-missing functions", () => {
  const diagnostics = buildCapabilityDiagnostics({ functions: [{ name: "core_webservice_get_site_info" }, { name: "core_calendar_get_action_events_by_course" }, { name: "local_ncstate_custom" }] });
  assert.equal(diagnostics.find((item) => item.name === "core_calendar_get_action_events_by_course")?.available, true);
  assert.equal(diagnostics.find((item) => item.name === "mod_quiz_get_quizzes_by_courses")?.available, false);
  assert.equal(diagnostics.find((item) => item.name === "local_ncstate_custom")?.group, "other");
});
