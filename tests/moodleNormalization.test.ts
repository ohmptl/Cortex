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
import { AcademicService } from "../src/domain/service.ts";
import type { AcademicRepository } from "../src/domain/repository.ts";

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

test("event disappearance does not tombstone an activity still present in course contents", async () => {
  const first = await projectMoodleSnapshot(emptyProjectionState(), fixture);
  const partial = structuredClone(fixture);
  partial.events = partial.events?.slice(1);
  partial.completeScopes = partial.completeScopes?.filter((scope) => scope !== "events");
  const partialResult = await projectMoodleSnapshot(first.state, partial);
  assert.equal(partialResult.state.items["activity:assign:9001"].upstreamState, "present");
  partial.completeScopes = [...(partial.completeScopes ?? []), "events"];
  const completeResult = await projectMoodleSnapshot(first.state, partial);
  assert.equal(completeResult.state.items["activity:assign:9001"].upstreamState, "present");
  assert.equal(completeResult.counters.missing, 0);
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

function forumSnapshot(state = 0): MoodleSnapshot {
  return {
    courses: [{ id: 331, shortname: "ENG 331", fullname: "ENG 331 (604) FALL 2026", visible: 1 }],
    courseContents: [{ courseId: "331", sections: [{ id: 1, modules: [
      { id: 1550530, instance: 81001, modname: "forum", name: "Post to Challenger: Part 2", visible: true,
        url: "https://moodle.example.edu/mod/forum/view.php?id=1550530", completiondata: { state } },
      { id: 1550582, instance: 81002, modname: "forum", name: "Audience Analysis", visible: true, completiondata: { state: 0 } },
    ] }] }],
    forums: [
      { id: 81001, course: 331, cmid: 1550530, name: "Post to Challenger: Part 2", completionposts: 2, completiondiscussions: 1, completionreplies: 1 },
      { id: 81002, course: 331, cmid: 1550582, name: "Audience Analysis" },
    ],
    events: [
      { id: 90001, courseid: 331, cmid: 1550530, instance: 81001, modulename: "forum", name: "Post to Challenger: Part 2", timesort: 1788494340 },
      { id: 90002, courseid: 331, cmid: 1550582, instance: 81002, modulename: "forum", name: "Audience Analysis", timesort: 1788926340 },
    ],
    completeScopes: ["courses", "contents", "events"],
  };
}

test("multiple Moodle forums remain present and calendar/module sources deduplicate", async () => {
  const { state } = await projectMoodleSnapshot(emptyProjectionState(), forumSnapshot());
  assert.equal(Object.keys(state.items).length, 2);
  assert.equal(state.items["activity:forum:81001"].upstreamState, "present");
  assert.equal(state.items["activity:forum:81002"].upstreamState, "present");
  assert.equal(state.items["activity:forum:81001"].type, "discussion");
  assert.equal(state.items["activity:forum:81001"].sourceDueAt, "2026-09-04T03:59:00.000Z");
  assert.equal(state.items["activity:forum:81001"].status, "not_started");
  assert.equal(state.items["activity:forum:81001"].completionState, "0");
});

test("completed Moodle forums retain completed state", async () => {
  const first = await projectMoodleSnapshot(emptyProjectionState(), forumSnapshot(1));
  const second = await projectMoodleSnapshot(first.state, forumSnapshot(1));
  assert.equal(second.state.items["activity:forum:81001"].status, "completed");
  assert.equal(second.state.items["activity:forum:81001"].completionState, "1");
});

test("forum deadlines survive a module-only refresh and remain agenda eligible", async () => {
  const first = await projectMoodleSnapshot(emptyProjectionState(), forumSnapshot());
  const moduleOnly = forumSnapshot();
  moduleOnly.events = [];
  moduleOnly.forums = [];
  const second = await projectMoodleSnapshot(first.state, moduleOnly);
  const item = second.state.items["activity:forum:81001"];
  assert.equal(item.upstreamState, "present");
  assert.equal(item.sourceDueAt, "2026-09-04T03:59:00.000Z");
  const due = new Date(item.sourceDueAt!);
  assert.ok(due >= new Date("2026-09-03T04:00:00.000Z") && due <= new Date("2026-09-04T04:00:00.000Z"));
  assert.ok(due >= new Date("2026-09-03T12:00:00.000Z") && due <= new Date("2026-09-18T04:00:00.000Z"));
});

test("a present incomplete forum is returned by get_today and get_upcoming", async () => {
  const { state } = await projectMoodleSnapshot(emptyProjectionState(), forumSnapshot());
  const forum = state.items["activity:forum:81001"];
  const repository = {
    async listAcademicItems(options: { from?: string; to?: string }) {
      const due = forum.sourceDueAt!;
      return forum.upstreamState === "present" && (!options.from || due >= options.from) && (!options.to || due <= options.to)
        ? [forum]
        : [];
    },
  } as unknown as AcademicRepository;
  const service = new AcademicService(repository);
  const now = new Date("2026-09-03T16:00:00.000Z");
  assert.deepEqual((await service.getToday(now)).map((item) => item.title), ["Post to Challenger: Part 2"]);
  assert.deepEqual((await service.getUpcoming(14, now)).map((item) => item.title), ["Post to Challenger: Part 2"]);
  assert.equal(forum.status, "not_started");
});

test("a forum removed from complete course contents becomes missing", async () => {
  const first = await projectMoodleSnapshot(emptyProjectionState(), forumSnapshot());
  const deleted = forumSnapshot();
  const modules = deleted.courseContents?.[0]?.sections[0]?.modules as Array<Record<string, unknown>>;
  deleted.courseContents![0].sections[0].modules = modules.filter((module) => module.instance !== 81001);
  deleted.forums = deleted.forums?.filter((forum) => forum.id !== 81001);
  deleted.events = deleted.events?.filter((event) => event.instance !== 81001);
  const second = await projectMoodleSnapshot(first.state, deleted);
  assert.equal(second.state.items["activity:forum:81001"].upstreamState, "missing");
});
