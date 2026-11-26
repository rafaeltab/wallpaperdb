import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {clearAggregate} from './delivery.mjs';

const directory=await mkdtemp(resolve(tmpdir(),'coverage-cleanup-'));
try {
 await mkdir(directory+'/.crap-lock');
 await writeFile(directory+'/.crap-lock/owner','live caller');
 await mkdir(directory+'/html');await writeFile(directory+'/html/index.html','old report');
 await writeFile(directory+'/coverage-final.json','old report');
 await clearAggregate(directory);
 assert.equal(await readFile(directory+'/.crap-lock/owner','utf8'),'live caller');
 assert.deepEqual(await readdir(directory),['.crap-lock']);
 await clearAggregate(directory);
 assert.equal(await readFile(directory+'/.crap-lock/owner','utf8'),'live caller');
 console.log('Normal invalidation and failure cleanup preserve the live CRAP lock and remove report artifacts');
} finally {await rm(directory,{recursive:true,force:true});}
