// Preserve the real container/network lifecycle while mounting the full
// dependency graph and transporting official V8 output to its host collector.
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'');
export const coverageExit = 'result=$?; chown "$EXPERIMENT_V8_UID:$EXPERIMENT_V8_GID" "$NODE_V8_COVERAGE"/coverage-*.json; transfer=$?; echo OUTAGE_EXIT=$result; if [ "$result" -ne 0 ]; then exit "$result"; fi; exit "$transfer"';
export function containerExecution(builder) {
 const destination=process.env.NODE_V8_COVERAGE;
 if(!destination)throw new Error('CONTAINER_COVERAGE_DESTINATION_MISSING');
 // Docker otherwise creates an absent bind source as root, preventing the
 // host collector from unlinking even correctly handed-off files.
 mkdirSync(destination,{recursive:true,mode:0o700});
 return builder.withBindMounts([
  {source:root,target:root,mode:'ro'},
  {source:destination,target:destination,mode:'rw'},
 ]).withEnvironment({
  NODE_OPTIONS:`--import=${fileURLToPath(new URL('./native-hook.mjs',import.meta.url))}`,
  NODE_V8_COVERAGE:destination,
  EXPERIMENT_V8_UID:String(process.getuid()),
  EXPERIMENT_V8_GID:String(process.getgid()),
 });
}
