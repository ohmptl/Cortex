import assert from "node:assert/strict";
import test from "node:test";
import { evaluateForumParticipation } from "../supabase/functions/moodle-sync-worker/forum-participation.ts";
import {
  grades,
  state,
  type Ctx,
  type MoodleCall,
} from "../supabase/functions/moodle-sync-worker/engine.ts";
import { databaseClient } from "./helpers/postgrest-db.ts";
import { moodleDatabase, OWNER, seedConnection } from "./helpers/moodle-db.ts";

const counts = () => ({
  inserted: 0,
  updated: 0,
  unchanged: 0,
  missing: 0,
  skipped: 0,
  failed: 0,
});

test("forum participation counts only the current user and respects post/discussion/reply requirements", () => {
  const participation = evaluateForumParticipation({
    forum: {
      completionposts: 3,
      completiondiscussions: 1,
      completionreplies: 2,
    },
    userId: "42",
    discussions: [
      { id: 10, userid: 42 },
      { id: 20, userid: 99 },
    ],
    posts: [
      { id: 1, discussionid: 10, parentid: 0, userid: 42, created: 100 },
      { id: 2, discussionid: 10, parentid: 1, userid: 42, created: 200 },
      {
        id: 3,
        discussionid: 20,
        parentid: 9,
        author: { id: 42 },
        created: 300,
      },
      { id: 4, discussionid: 20, parentid: 9, userid: 99, created: 400 },
    ],
  });
  assert.deepEqual(participation, {
    completed: true,
    submittedAt: new Date(300_000).toISOString(),
    discussions: 1,
    posts: 3,
    replies: 2,
  });
  assert.equal(
    evaluateForumParticipation({
      forum: { completionreplies: 3 },
      userId: "42",
      discussions: [],
      posts: [{ parentid: 1, userid: 99 }],
    }).completed,
    false,
  );
});

test("forum sync uses completion first, then current-user participation, then a linked grade, and is idempotent", async () => {
  const db = await moodleDatabase();
  try {
    const connection = await seedConnection(db);
    const course = (
      await db.query<{ id: string }>(
        "select reconcile_moodle_course($1,'101','ENG','Communication',true) id",
        [connection],
      )
    ).rows[0].id;
    await db.query(
      `insert into academic_items(owner_id,course_id,origin,item_type,status,completion_state,provider,provider_connection_id,provider_course_id,provider_module_id,provider_instance_id,provider_item_id,title)
       values($1,$2,'provider','discussion','completed','forum:participated','moodle',$3,'101','1006','706','activity:forum:706','Previously completed')`,
      [OWNER, course, connection],
    );
    const modules = [
      {
        id: 1001,
        instance: 701,
        modname: "forum",
        name: "Completion enabled",
        completiondata: { state: 1 },
      },
      {
        id: 1002,
        instance: 702,
        modname: "forum",
        name: "Current user posted",
        completion: 0,
      },
      {
        id: 1003,
        instance: 703,
        modname: "forum",
        name: "Graded forum",
        completion: 0,
      },
      {
        id: 1004,
        instance: 704,
        modname: "forum",
        name: "No posts",
        completion: 0,
      },
      {
        id: 1005,
        instance: 705,
        modname: "forum",
        name: "Other user only",
        completion: 0,
      },
      {
        id: 1006,
        instance: 706,
        modname: "forum",
        name: "Previously completed",
        completion: 0,
      },
    ];
    const forumRows = modules.map((module) => ({
      id: module.instance,
      cmid: module.id,
      name: module.name,
    }));
    const discussions: Record<string, Array<Record<string, unknown>>> = {
      "702": [{ id: 2002, userid: 99 }],
      "705": [{ id: 2005, userid: 99 }],
    };
    const posts: Record<string, Array<Record<string, unknown>>> = {
      "2002": [
        {
          id: 3002,
          discussionid: 2002,
          parentid: 1,
          userid: 42,
          created: 1_788_000_000,
        },
      ],
      "2005": [
        {
          id: 3005,
          discussionid: 2005,
          parentid: 0,
          userid: 99,
          created: 1_788_000_100,
        },
      ],
    };
    let participationCalls = 0;
    const call: MoodleCall = async <T>(
      _url: string,
      _token: string,
      fn: string,
      params?: Record<string, unknown>,
    ) => {
      if (fn === "core_course_get_contents") return [{ id: 1, modules }] as T;
      if (fn === "mod_forum_get_forums_by_courses") return forumRows as T;
      if (fn === "mod_forum_get_forum_discussions") {
        participationCalls++;
        assert.equal(params?.sortorder, -1);
        assert.equal(params?.perpage, 50);
        return { discussions: discussions[String(params?.forumid)] ?? [] } as T;
      }
      if (fn === "mod_forum_get_discussion_posts")
        return { posts: posts[String(params?.discussionid)] ?? [] } as T;
      if (fn === "gradereport_user_get_grade_items")
        return {
          usergrades: [
            {
              gradeitems: [
                {
                  id: 9003,
                  itemtype: "mod",
                  itemmodule: "forum",
                  iteminstance: 703,
                  itemname: "Graded forum",
                  graderaw: 3,
                  grademax: 3,
                  percentageformatted: "100.00%",
                },
              ],
            },
          ],
        } as T;
      throw new Error(`Unexpected Moodle call ${fn}`);
    };
    const base = {
      client: databaseClient(db),
      call,
      owner_id: OWNER,
      connection_id: connection,
      scope_external_id: "101",
      sync_run_id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      baseUrl: "https://moodle.test",
      token: "test",
      userId: "42",
      optional: [],
    };
    const eventContext = {
      ...base,
      phase: "events",
      allowed: new Set([
        "core_course_get_contents",
        "mod_forum_get_forums_by_courses",
        "mod_forum_get_forum_discussions",
        "mod_forum_get_discussion_posts",
      ]),
    } as Ctx;
    const gradeContext = {
      ...base,
      phase: "grades",
      allowed: new Set(["gradereport_user_get_grade_items"]),
    } as Ctx;

    await state(eventContext, counts());
    let rows = (
      await db.query<{
        provider_instance_id: string;
        status: string;
        completion_state: string | null;
        submission_state: string | null;
        submitted_at: string | null;
      }>(
        "select provider_instance_id,status,completion_state,submission_state,submitted_at from academic_items where merged_into_id is null order by provider_instance_id",
      )
    ).rows;
    const byId = () =>
      new Map(rows.map((row) => [row.provider_instance_id, row]));
    assert.equal(byId().get("701")?.status, "completed");
    assert.equal(byId().get("701")?.completion_state, "1");
    assert.equal(byId().get("702")?.status, "completed");
    assert.equal(byId().get("702")?.completion_state, "forum:participated");
    assert.equal(byId().get("702")?.submission_state, "submitted");
    assert.ok(byId().get("702")?.submitted_at);
    assert.equal(byId().get("703")?.status, "not_started");
    assert.equal(byId().get("704")?.status, "not_started");
    assert.equal(byId().get("705")?.status, "not_started");
    assert.equal(byId().get("706")?.status, "completed");
    assert.equal(byId().get("706")?.completion_state, "forum:participated");
    assert.equal(
      participationCalls,
      5,
      "completion-enabled forums skip participation lookup",
    );

    await grades(gradeContext, counts());
    rows = (
      await db.query(
        "select provider_instance_id,status,completion_state,submission_state,submitted_at from academic_items where merged_into_id is null order by provider_instance_id",
      )
    ).rows as typeof rows;
    assert.equal(byId().get("703")?.status, "completed");
    assert.equal(byId().get("703")?.completion_state, "grade:posted");
    assert.equal(byId().get("703")?.submission_state, "graded");

    const itemCount = rows.length;
    await state(eventContext, counts());
    await grades(gradeContext, counts());
    const repeated = (
      await db.query<{
        provider_instance_id: string;
        status: string;
        completion_state: string | null;
      }>(
        "select provider_instance_id,status,completion_state from academic_items where merged_into_id is null order by provider_instance_id",
      )
    ).rows;
    assert.equal(repeated.length, itemCount);
    assert.equal(
      repeated.find((row) => row.provider_instance_id === "703")
        ?.completion_state,
      "grade:posted",
    );
    assert.equal(
      repeated.find((row) => row.provider_instance_id === "706")?.status,
      "completed",
    );
    assert.equal(
      repeated.find((row) => row.provider_instance_id === "706")
        ?.completion_state,
      "forum:participated",
    );
  } finally {
    await db.close();
  }
});
