import assert from "node:assert/strict";
import test from "node:test";
import { hasMoodleGradeResult, isMoodleActivityComplete } from "../supabase/functions/_shared/completion.ts";

test("Moodle completion states project completed activities", () => {
  assert.equal(isMoodleActivityComplete({ state: 1 }), true);
  assert.equal(isMoodleActivityComplete({ state: 2 }), true);
  assert.equal(isMoodleActivityComplete({ isoverallcomplete: true }), true);
  assert.equal(isMoodleActivityComplete({ state: 0, isoverallcomplete: false }), false);
});

test("a real Moodle grade, including zero, counts as completed work", () => {
  assert.equal(hasMoodleGradeResult({ graderaw: 0, percentageformatted: "0.00%" }), true);
  assert.equal(hasMoodleGradeResult({ graderaw: 30, percentageformatted: "100.00%" }), true);
  assert.equal(hasMoodleGradeResult({ gradeformatted: "-", percentageformatted: "-" }), false);
  assert.equal(hasMoodleGradeResult({ graderaw: null, gradeformatted: null }), false);
});
