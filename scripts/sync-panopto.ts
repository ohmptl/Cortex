import { syncPanoptoCourse } from "../src/providers/panopto/sync";
const courseId=process.argv[2];if(!courseId)throw new Error("Usage: npm run sync:panopto -- <cortex-course-uuid>");
console.log(JSON.stringify(await syncPanoptoCourse(courseId,process.env.CORTEX_OWNER_ID),null,2));
