import assert from "node:assert/strict";
import test from "node:test";
import {
  state,
  StatePage,
  type Ctx,
  type MoodleCall,
} from "../supabase/functions/moodle-sync-worker/engine.ts";
import { moodleDatabase, seedConnection, OWNER } from "./helpers/moodle-db.ts";
import { databaseClient } from "./helpers/postgrest-db.ts";
const counts = () => ({
  inserted: 0,
  updated: 0,
  unchanged: 0,
  missing: 0,
  skipped: 0,
  failed: 0,
});

test("real worker converges module-only assignments/quizzes/forums, merges legacy rows with user data, resets completion, and is idempotent", async () => {
  const db = await moodleDatabase();
  try {
    const connection = await seedConnection(db);
    const course = (
      await db.query<{ id: string }>(
        "select reconcile_moodle_course($1,'101','ENG','Communication',true) id",
        [connection],
      )
    ).rows[0].id;
    const activity = (
      modname: string,
      id: number,
      instance: number,
      name: string,
      completion: unknown,
    ) => ({
      id,
      instance,
      modname,
      name,
      completiondata: completion,
      url: `https://moodle.test/mod/${modname}/view.php?id=${id}`,
    });
    let modules = [
      activity("quiz", 1356315, 501, "Quiz 4", { state: 1 }),
      activity("assign", 1356316, 502, "Quiz 4 work upload", { state: 1 }),
      activity("forum", 1550530, 503, "Post to Challenger: Part 2", {
        state: 1,
      }),
      activity("assign", 1239000, 504, "Product Requirements Document", {
        state: 1,
      }),
    ];
    const legacy = (
      await db.query<{ id: string }>(
        `insert into academic_items(owner_id,course_id,origin,item_type,provider,provider_connection_id,provider_course_id,provider_item_id,url,title)
      values($1,$2,'provider','discussion','moodle',$3,'101','calendar-event:55','https://moodle.test/mod/forum/view.php?id=1550530','Challenger') returning id`,
        [OWNER, course, connection],
      )
    ).rows[0].id;
    const canonical = (
      await db.query<{ id: string }>(
        `insert into academic_items(owner_id,course_id,origin,item_type,provider,provider_connection_id,provider_course_id,provider_item_id,title)
      values($1,$2,'provider','discussion','moodle',$3,'101','activity:forum:503','Challenger') returning id`,
        [OWNER, course, connection],
      )
    ).rows[0].id;
    await db.query(
      "insert into notes(owner_id,academic_item_id,body) values($1,$2,'Keep this')",
      [OWNER, legacy],
    );
    await db.query(
      "insert into field_overrides(owner_id,academic_item_id,field_name,value) values($1,$2,'due_at','\"2026-09-20T00:00:00Z\"')",
      [OWNER, legacy],
    );
    const call: MoodleCall = async <T>(
      _url: string,
      _token: string,
      fn: string,
    ) => {
      if (fn === "core_course_get_contents") return [{ id: 1, modules }] as T;
      throw new Error("Unexpected call " + fn);
    };
    const ctx: Ctx = {
      client: databaseClient(db),
      call,
      owner_id: OWNER,
      connection_id: connection,
      scope_external_id: "101",
      sync_run_id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      phase: "events",
      baseUrl: "https://moodle.test",
      token: "test",
      userId: "42",
      allowed: new Set(["core_course_get_contents"]),
      optional: [],
    };
    await state(ctx, counts());
    let items = (
      await db.query<{ id: string; status: string; provider_item_id: string }>(
        "select * from academic_items where merged_into_id is null",
      )
    ).rows;
    assert.equal(items.length, 4);
    assert.ok(items.every((row) => row.status === "completed"));
    assert.equal(
      (await db.query<{ academic_item_id: string }>("select * from notes"))
        .rows[0].academic_item_id,
      canonical,
    );
    assert.equal(
      (
        await db.query<{ academic_item_id: string }>(
          "select * from field_overrides",
        )
      ).rows[0].academic_item_id,
      canonical,
    );
    const historyCount = (
      await db.query("select * from academic_item_source_history")
    ).rows.length;
    await state(ctx, counts());
    assert.equal(
      (
        await db.query(
          "select * from academic_items where merged_into_id is null",
        )
      ).rows.length,
      4,
    );
    assert.equal(
      (await db.query("select * from academic_item_source_history")).rows
        .length,
      historyCount,
    );
    modules = modules.map((row) => ({ ...row, completiondata: { state: 0 } }));
    await state(ctx, counts());
    items = (
      await db.query<(typeof items)[number]>(
        "select * from academic_items where merged_into_id is null",
      )
    ).rows;
    assert.ok(items.every((row) => row.status === "not_started"));
    modules = [];
    await state(ctx, counts());
    assert.equal(
      (
        await db.query(
          "select * from academic_items where upstream_state='present'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from field_overrides")).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});

test("worker submission and quiz attempts are authoritative without tracking; checkpoint resumes a large course", async () => {
  const db = await moodleDatabase();
  try {
    const connection = await seedConnection(db);
    await db.query(
      "select reconcile_moodle_course($1,'101','HESF','Cross Training',true)",
      [connection],
    );
    const modules = Array.from({ length: 35 }, (_, i) => ({
      id: 100 + i,
      instance: 200 + i,
      modname: i === 0 ? "assign" : "quiz",
      name: i === 1 ? "Chapter Two Quiz" : `Activity ${i}`,
      completion: 0,
    }));
    let submitted = true;
    const call: MoodleCall = async <T>(
      _u: string,
      _t: string,
      fn: string,
      params?: Record<string, unknown>,
    ) => {
      if (fn === "core_course_get_contents") return [{ id: 1, modules }] as T;
      if (fn === "mod_assign_get_submission_status")
        return {
          lastattempt: {
            submission: { status: submitted ? "submitted" : "draft" },
          },
        } as T;
      if (fn === "mod_quiz_get_user_attempts")
        return {
          attempts:
            params?.quizid === "201"
              ? [{ state: submitted ? "finished" : "inprogress", preview: 0 }]
              : [],
        } as T;
      throw new Error(fn);
    };
    const ctx: Ctx = {
      client: databaseClient(db),
      call,
      owner_id: OWNER,
      connection_id: connection,
      scope_external_id: "101",
      sync_run_id: crypto.randomUUID(),
      id: crypto.randomUUID(),
      phase: "events",
      baseUrl: "https://moodle.test",
      token: "test",
      userId: "42",
      allowed: new Set([
        "core_course_get_contents",
        "mod_assign_get_submission_status",
        "mod_quiz_get_user_attempts",
      ]),
      optional: [],
    };
    async function full() {
      ctx.cursor = {};
      for (let i = 0; i < 10; i++)
        try {
          await state(ctx, counts());
          return;
        } catch (error) {
          if (!(error instanceof StatePage)) throw error;
          ctx.cursor = { written: error.written };
        }
      throw new Error("Checkpoint did not converge");
    }
    await full();
    assert.equal(
      (await db.query("select * from academic_items")).rows.length,
      35,
    );
    assert.equal(
      (await db.query("select * from academic_items where status='completed'"))
        .rows.length,
      2,
    );
    submitted = false;
    await full();
    assert.equal(
      (await db.query("select * from academic_items where status='completed'"))
        .rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("action calendars honor Moodle's 50-event maximum and page by event ID",async()=>{
 const {actionEvents}=await import('../supabase/functions/moodle-sync-worker/calendar.ts');
 const seen:unknown[]=[];
 const call:MoodleCall=async<T>(_u:string,_t:string,_fn:string,params?:Record<string,unknown>)=>{
  assert.equal(params?.limitnum,50);seen.push(params?.aftereventid);
  return (params?.aftereventid==='0'?{events:Array.from({length:50},(_,i)=>({id:i+1})),lastid:50}:{events:[{id:51}],lastid:51}) as T;
 };
 const result=await actionEvents({call,baseUrl:'https://moodle.test',token:'test',scope_external_id:'101'} as Ctx);
 assert.equal(result.length,51);assert.deepEqual(seen,['0','50']);
});

test("complete enrollment disappearance marks only that connection's provider work missing",async()=>{
 const db=await moodleDatabase();
 try{
  const {bootstrap}=await import('../supabase/functions/moodle-sync-worker/engine.ts');
  const connection=await seedConnection(db);
  const course=(await db.query<{id:string}>("select reconcile_moodle_course($1,'101','ENG','Communication',true) id",[connection])).rows[0].id;
  await db.query(`insert into academic_items(owner_id,course_id,item_type,title,origin,provider_connection_id) values($1,$2,'assignment','Provider work','provider',$3),($1,$2,'review','Personal review','manual',null)`,[OWNER,course,connection]);
  const call:MoodleCall=async<T>(_u:string,_t:string,fn:string)=> (fn==='core_webservice_get_site_info'?{userid:42,functions:['core_enrol_get_users_courses']}:[]) as T;
  await bootstrap({client:databaseClient(db),call,owner_id:OWNER,connection_id:connection,userId:'42',baseUrl:'https://moodle.test',token:'test',optional:[]} as unknown as Ctx,counts());
  assert.equal((await db.query<{upstream_state:string}>("select * from academic_items where origin='provider'")).rows[0].upstream_state,'missing');
  assert.equal((await db.query<{upstream_state:string}>("select * from academic_items where origin='manual'")).rows[0].upstream_state,'present');
 }finally{await db.close();}
});

test("Moodle-inaccessible activities retain reported state without an unauthorized private lookup",async()=>{
 const db=await moodleDatabase();
 try{
  const connection=await seedConnection(db);
  await db.query("select reconcile_moodle_course($1,'101','ENG','Communication',true)",[connection]);
  const call:MoodleCall=async<T>(_u:string,_t:string,fn:string)=>{
   if(fn!=='core_course_get_contents')throw new Error('Private lookup must not be called');
   return [{id:1,modules:[{id:1550726,instance:112,modname:'assign',name:'Future team assignment',uservisible:false,completiondata:{state:0,uservisible:false}}]}] as T;
  };
  const ctx={client:databaseClient(db),call,owner_id:OWNER,connection_id:connection,scope_external_id:'101',baseUrl:'https://moodle.test',token:'test',userId:'42',allowed:new Set(['core_course_get_contents','mod_assign_get_submission_status']),optional:[]} as unknown as Ctx;
  const result=counts();await state(ctx,result);
  assert.equal(result.failed,0);assert.equal(result.skipped,1);assert.equal(ctx.optional[0].skipped,true);
  assert.equal((await db.query<{status:string}>("select * from academic_items")).rows[0].status,'not_started');
 }finally{await db.close();}
});
