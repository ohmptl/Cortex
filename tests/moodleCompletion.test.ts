import assert from "node:assert/strict";
import test from "node:test";
import { hasMoodleGradeResult, isMoodleActivityComplete } from "../supabase/functions/_shared/completion.ts";

test("Moodle completion states project completed activities", () => {
  assert.equal(isMoodleActivityComplete({ state: 1 }), true);
  assert.equal(isMoodleActivityComplete({ state: 2 }), true);
  assert.equal(isMoodleActivityComplete({ isoverallcomplete: true }), true);
  assert.equal(isMoodleActivityComplete({ state: 0, isoverallcomplete: false }), false);
});

test("grade presence, including zero, is detectable separately from completion", () => {
  assert.equal(hasMoodleGradeResult({ graderaw: 0, percentageformatted: "0.00%" }), true);
  assert.equal(hasMoodleGradeResult({ graderaw: 30, percentageformatted: "100.00%" }), true);
  assert.equal(hasMoodleGradeResult({ gradeformatted: "-", percentageformatted: "-" }), false);
  assert.equal(hasMoodleGradeResult({ graderaw: null, gradeformatted: null }), false);
});

test("completion distinguishes authoritative incomplete from disabled tracking and unknown",async()=>{
  const {moodleCompletion}=await import("../supabase/functions/_shared/completion.ts");
  assert.equal(moodleCompletion({module:{completion:0}}),null);
  assert.equal(moodleCompletion({module:{completiondata:{state:0,hascompletion:true}}}),false);
  assert.equal(moodleCompletion({module:{completiondata:{state:3}}}),true);
  assert.equal(moodleCompletion({submission:{status:"submitted"}}),true);
  assert.equal(moodleCompletion({submission:{status:"draft"}}),false);
  assert.equal(moodleCompletion({attempts:[{state:"finished",preview:0}]}),true);
  assert.equal(moodleCompletion({attempts:[{state:"finished",preview:1}]}),false);
  assert.equal(moodleCompletion({attempts:[{state:"inprogress"}]}),false);
  assert.equal(moodleCompletion({module:{completiondata:{state:0}},attempts:[{state:"finished"}]}),false);
});
