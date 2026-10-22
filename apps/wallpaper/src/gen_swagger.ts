import {writeFile} from 'node:fs/promises';
import {Effect,Layer} from 'effect';
import {Availability} from './capabilities/availability/index.js';
import {Creation,CreatorAuthentication,WorkflowHealth} from './capabilities/creation/index.js';
import {createHttpApp,registerCreationHttp} from './http/index.js';
const app=await createHttpApp({nodeEnv:'development',port:3010},Layer.succeed(Availability,{health:()=>Effect.die('Documentation only'),ready:()=>Effect.die('Documentation only')}),{configure:app=>registerCreationHttp(app,Layer.mergeAll(Layer.succeed(CreatorAuthentication,{verify:()=>Effect.succeed(null)}),Layer.succeed(WorkflowHealth,{check:()=>Effect.succeed(true)}),Layer.succeed(Creation,{list:()=>Effect.die('Documentation only'),begin:()=>Effect.die('Documentation only'),get:()=>Effect.die('Documentation only'),expectSource:()=>Effect.die('Documentation only'),assetResult:()=>Effect.die('Documentation only'),sourceAccepted:()=>Effect.die('Documentation only')})))});
try{await writeFile('swagger.json',JSON.stringify(app.swagger(),null,2));}finally{await app.close();}
