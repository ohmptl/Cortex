import assert from "node:assert/strict";
import test from "node:test";
import { moodleDatabase, seedConnection, OWNER } from "./helpers/moodle-db.ts";

test("all deployed migrations plus Moodle integrity migrations execute; reconnect reuses course and preserves notes", async () => {
  const db = await moodleDatabase();
  try {
    const connection = await seedConnection(db);
    const course = async () =>
      (
        await db.query<{ id: string }>(
          "select reconcile_moodle_course($1,'101','ENG 331','Communication',true) id",
          [connection],
        )
      ).rows[0].id;
    const id = await course();
    await db.query(
      "insert into notes(owner_id,course_id,body) values($1,$2,'My course note')",
      [OWNER, id],
    );
    await db.query(
      "insert into provider_credentials(connection_id,owner_id,encrypted_payload) values($1,$2,'encrypted')",
      [connection, OWNER],
    );
    await db.exec("select disconnect_moodle()");
    assert.equal(
      (await db.query("select * from provider_credentials")).rows.length,
      0,
    );
    await db.query(
      "update provider_connections set status='active' where id=$1",
      [connection],
    );
    assert.equal(await course(), id);
    assert.equal((await db.query("select * from courses")).rows.length, 1);
    assert.equal(
      (await db.query("select * from notes where course_id=$1", [id])).rows
        .length,
      1,
    );
  } finally {
    await db.close();
  }
});

test("course consolidation preserves notes, overrides, personal grade rules, tags, relations, knowledge and Panopto links", async () => {
  const db = await moodleDatabase();
  try {
    const connection = await seedConnection(db);
    const canonical = (
      await db.query<{ id: string }>(
        "select reconcile_moodle_course($1,'101','ENG','Communication',true) id",
        [connection],
      )
    ).rows[0].id;
    const old = (
      await db.query<{ id: string }>(
        "insert into courses(owner_id,code,name) values($1,'ENG','Communication') returning id",
        [OWNER],
      )
    ).rows[0].id;
    const item = (
      await db.query<{ id: string }>(
        "insert into academic_items(owner_id,course_id,item_type,title) values($1,$2,'review','My review') returning id",
        [OWNER, old],
      )
    ).rows[0].id;
    const note = (
      await db.query<{ id: string }>(
        "insert into notes(owner_id,course_id,body) values($1,$2,'My note') returning id",
        [OWNER, old],
      )
    ).rows[0].id;
    await db.query(
      "insert into field_overrides(owner_id,course_id,field_name,value) values($1,$2,'color','\"red\"'),($1,$3,'color','\"blue\"')",
      [OWNER, old, canonical],
    );
    await db.query(
      "insert into grade_models(owner_id,course_id,name,is_default) values($1,$2,'Plan',true),($1,$3,'Plan',true)",
      [OWNER, old, canonical],
    );
    await db.query(
      "insert into knowledge_links(owner_id,source_note_id,target_course_id,relation) values($1,$2,$3,'RELATES_TO')",
      [OWNER, note, old],
    );
    await db.query(
      "insert into course_provider_links(owner_id,course_id,provider,link_type,external_id) values($1,$2,'panopto','folder','folder-1')",
      [OWNER, old],
    );
    await db.query("select merge_moodle_course($1,$2,$3)", [
      old,
      canonical,
      OWNER,
    ]);
    await db.query("select merge_moodle_course($1,$2,$3)", [
      old,
      canonical,
      OWNER,
    ]);
    assert.equal(
      (
        await db.query<{ course_id: string }>(
          "select * from academic_items where id=$1",
          [item],
        )
      ).rows[0].course_id,
      canonical,
    );
    assert.equal(
      (
        await db.query<{ course_id: string }>(
          "select * from notes where id=$1",
          [note],
        )
      ).rows[0].course_id,
      canonical,
    );
    assert.equal(
      (
        await db.query("select * from grade_models where course_id=$1", [
          canonical,
        ])
      ).rows.length,
      2,
    );
    assert.equal(
      (await db.query("select * from field_overrides")).rows.length,
      2,
    ); // Conflicting override intact on historical course.
    assert.equal(
      (await db.query("select * from moodle_reconciliation_issues")).rows
        .length,
      1,
    );
    assert.equal(
      (
        await db.query<{ target_course_id: string }>(
          "select * from knowledge_links",
        )
      ).rows[0].target_course_id,
      canonical,
    );
    assert.equal(
      (
        await db.query<{ course_id: string }>(
          "select * from course_provider_links where provider='panopto'",
        )
      ).rows[0].course_id,
      canonical,
    );
  } finally {
    await db.close();
  }
});

test("atomic queue creation, orphan run recovery, claim fencing, completion settlement and terminal run isolation", async () => {
  const db = await moodleDatabase();
  try {
    const connection = await seedConnection(db);
    const orphan = (
      await db.query<{ id: string }>(
        "insert into sync_runs(owner_id,connection_id,trigger_type) values($1,$2,'scheduled') returning id",
        [OWNER, connection],
      )
    ).rows[0].id;
    await db.exec("select recover_moodle_sync()");
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from sync_runs where id=$1",
          [orphan],
        )
      ).rows[0].status,
      "failed",
    );
    const enqueue = async () =>
      (
        await db.query<{ id: string }>(
          "select enqueue_moodle_sync($1,'manual') id",
          [connection],
        )
      ).rows[0].id;
    const run = await enqueue();
    assert.equal(await enqueue(), run);
    const token = crypto.randomUUID();
    const tasks = (
      await db.query<{ id: string }>(
        "select * from claim_sync_tasks_for_run($1,$2,3,false)",
        [token, run],
      )
    ).rows;
    assert.equal(tasks.length, 1);
    await assert.rejects(
      db.query(
        "select settle_moodle_task($1,$2,'succeeded','{}','{}',null,'test')",
        [tasks[0].id, crypto.randomUUID()],
      ),
      /claim/,
    );
    await db.query(
      "select settle_moodle_task($1,$2,'succeeded','{}','{}',null,'test')",
      [tasks[0].id, token],
    );
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from sync_runs where id=$1",
          [run],
        )
      ).rows[0].status,
      "succeeded",
    );
    await assert.rejects(
      db.query(
        "select settle_moodle_task($1,$2,'succeeded','{}','{}',null,'test')",
        [tasks[0].id, token],
      ),
      /terminal/,
    );
    assert.equal(
      (
        await db.query(
          "select * from claim_sync_tasks_for_run($1,$2,3,false)",
          [token, run],
        )
      ).rows.length,
      0,
    );
    const status = (
      await db.query<{
        value: { lastSuccessfulRun: { id: string }; tasks: unknown[] };
      }>("select get_moodle_sync_status() value")
    ).rows[0].value;
    assert.equal(status.lastSuccessfulRun.id, run);
  } finally {
    await db.close();
  }
});

test("duplicate item and grade recovery preserve tags, relationships and personal grade rules",async()=>{
 const db=await moodleDatabase();
 try{
  const connection=await seedConnection(db);
  const course=(await db.query<{id:string}>("select reconcile_moodle_course($1,'101','ENG','Communication',true) id",[connection])).rows[0].id;
  const ids=(await db.query<{id:string}>(`insert into academic_items(owner_id,course_id,item_type,title,origin,provider,provider_course_id,provider_connection_id,provider_item_id)
   values($1,$2,'discussion','Forum','provider','moodle','101',$3,'activity:forum:11'),($1,$2,'discussion','Legacy','provider','moodle','101',$3,'course-module:22') returning id`,[OWNER,course,connection])).rows.map(r=>r.id);
  const tag=(await db.query<{id:string}>("insert into tags(owner_id,name) values($1,'Important') returning id",[OWNER])).rows[0].id;
  await db.query("insert into academic_item_tags(owner_id,academic_item_id,tag_id) values($1,$2,$3)",[OWNER,ids[1],tag]);
  const review=(await db.query<{id:string}>("insert into academic_items(owner_id,course_id,item_type,title) values($1,$2,'review','Study') returning id",[OWNER,course])).rows[0].id;
  await db.query("insert into academic_item_relations(owner_id,source_item_id,target_item_id,relation_type) values($1,$2,$3,'reviews')",[OWNER,review,ids[1]]);
  const grades=(await db.query<{id:string}>(`insert into grade_items(owner_id,course_id,name,academic_item_id,provider,provider_course_id,provider_item_id,provider_connection_id)
   values($1,$2,'Grade',$3,'moodle','101','55',$4),($1,$2,'Old grade',$3,'moodle','101','55',null) returning id`,[OWNER,course,ids[1],connection])).rows.map(r=>r.id);
  const model=(await db.query<{id:string}>("insert into grade_models(owner_id,course_id,name) values($1,$2,'What if') returning id",[OWNER,course])).rows[0].id;
  await db.query("insert into grade_model_item_rules(owner_id,model_id,grade_item_id,score_override) values($1,$2,$3,99)",[OWNER,model,grades[1]]);
  await db.query("select reconcile_moodle_item($1,$2,'101','activity:forum:11','22',null,array['course-module:22'])",[connection,course]);
  assert.equal((await db.query<{academic_item_id:string}>("select * from academic_item_tags")).rows[0].academic_item_id,ids[0]);
  assert.equal((await db.query<{target_item_id:string}>("select * from academic_item_relations")).rows[0].target_item_id,ids[0]);
  assert.ok((await db.query<{academic_item_id:string}>("select * from grade_items")).rows.every(g=>g.academic_item_id===ids[0]));
  await db.query("select reconcile_moodle_grade($1,$2,'101','55',false)",[connection,course]);
  assert.equal((await db.query<{grade_item_id:string}>("select * from grade_model_item_rules")).rows[0].grade_item_id,grades[0]);
  assert.equal((await db.query("select * from grade_items where merged_into_id is null")).rows.length,1);
 }finally{await db.close();}
});

test("optional endpoint failures persist alongside phase counters in a PostgREST bulk insert",async()=>{
 const db=await moodleDatabase();
 try{
  const {syncStepRows}=await import('../supabase/functions/moodle-sync-worker/steps.ts');
  const {databaseClient}=await import('./helpers/postgrest-db.ts');
  const connection=await seedConnection(db);
  const run=(await db.query<{id:string}>("select enqueue_moodle_sync($1,'manual') id",[connection])).rows[0].id;
  const rows=syncStepRows({owner_id:OWNER,sync_run_id:run,phase:'events',scope_external_id:'101'},
   {inserted:2,updated:3,unchanged:0,missing:0,failed:1,skipped:0},[{capability:'core_completion_get_activities_completion_status',message:'Unavailable for this course'}],null,new Date().toISOString());
  const result=await databaseClient(db).from('sync_run_steps').insert(rows);
  assert.equal(result.error,null);
  assert.equal((await db.query("select * from sync_run_steps where status='failed'")).rows.length,1);
 }finally{await db.close();}
});
