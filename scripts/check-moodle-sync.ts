/** Uses the authenticated Supabase CLI. No credentials are printed or copied. */
import { execFileSync } from "node:child_process";
const commands=[
 ["functions","list"],
 ["migration","list"],
 ["db","query","--linked","select public.moodle_runtime_diagnostics() diagnostics"],
];
for(const args of commands){
 console.log(`\nSupabase ${args.slice(0,2).join(' ')}:`);
 try{console.log(execFileSync("npx",["supabase",...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));}
 catch(error){const result=error as {stderr?:Buffer;message?:string};console.error(result.stderr?.toString()??result.message);process.exitCode=1;}
}
