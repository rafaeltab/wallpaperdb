const trace: string[] = [];
export function neverCalled() { trace.push('never'); }
async function run() {
 await using resource = { async [Symbol.asyncDispose]() { trace.push('disposed'); } };
 trace.push('body');
}
await run();
console.log(JSON.stringify(trace));
