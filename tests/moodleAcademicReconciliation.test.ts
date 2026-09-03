import assert from "node:assert/strict";
import test from "node:test";
import {
  activityItemId,
  calendarItemId,
  missingMoodleItemIds,
  moduleItemId,
  resolveMoodleDeadline,
} from "../supabase/functions/_shared/moodle-academic.ts";

const forumModule = {
  id: 1550530,
  instance: 81001,
  modname: "forum",
  name: "Post to Challenger: Part 2",
};

test("course contents authoritatively keeps all module-backed activity types present", () => {
  const moduleIds = new Set([moduleItemId(forumModule)!]);
  const missing = missingMoodleItemIds([
    "activity:forum:81001",
    "activity:choice:44",
    "calendar-event:7001",
  ], {
    courseContentsComplete: true,
    calendarComplete: false,
    assignmentsComplete: false,
    quizzesComplete: false,
    forumsComplete: false,
    moduleItemIds: moduleIds,
    calendarItemIds: new Set(),
    assignmentItemIds: new Set(),
    quizItemIds: new Set(),
    forumItemIds: new Set(),
  });
  assert.deepEqual(missing, ["activity:choice:44"]);
});

test("deleted forums become missing only from a complete authoritative source", () => {
  const base = {
    calendarComplete: false,
    assignmentsComplete: false,
    quizzesComplete: false,
    forumsComplete: false,
    moduleItemIds: new Set<string>(),
    calendarItemIds: new Set<string>(),
    assignmentItemIds: new Set<string>(),
    quizItemIds: new Set<string>(),
    forumItemIds: new Set<string>(),
  };
  assert.deepEqual(missingMoodleItemIds(["activity:forum:81001"], { ...base, courseContentsComplete: false }), []);
  assert.deepEqual(missingMoodleItemIds(["activity:forum:81001"], { ...base, courseContentsComplete: true }), ["activity:forum:81001"]);
});

test("calendar and course-module forum records resolve to one provider item", () => {
  const event = { id: 7001, cmid: 1550530, instance: 81001, modulename: "forum" };
  assert.equal(moduleItemId(forumModule), "activity:forum:81001");
  assert.equal(calendarItemId(event, forumModule), "activity:forum:81001");
  assert.equal(activityItemId("forum", 81001), "activity:forum:81001");
});

test("forum deadlines prefer structured sources and preserve a prior deadline when absent", () => {
  assert.equal(resolveMoodleDeadline({
    activity: { duedate: 1788494340 },
    event: { timesort: 1788580740 },
    previousDueAt: "2026-09-10T03:59:00.000Z",
    preservePrevious: true,
  }), "2026-09-04T03:59:00.000Z");
  assert.equal(resolveMoodleDeadline({
    previousDueAt: "2026-09-04T03:59:00.000Z",
    preservePrevious: true,
  }), "2026-09-04T03:59:00.000Z");
  assert.equal(resolveMoodleDeadline({ previousDueAt: "2026-09-04T03:59:00.000Z" }), null);
});

