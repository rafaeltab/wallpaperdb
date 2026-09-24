import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { hsvHistogram } from '../evaluation/loop/adapters.mjs';
import { extractSampleFeatures } from './corpus-features.mjs';
const sharp=createRequire(new URL('../../../apps/color-extractor/package.json',import.meta.url))('sharp');
sharp.concurrency(1);sharp.cache({memory:32,files:0,items:20});
parentPort.on('message',async asset=>{
  try {
    const bytes=await readFile(asset.filename);
    const actual=createHash('sha256').update(bytes).digest('hex');
    if(actual!==asset.sha256)throw Error(`Source hash changed for ${asset.id}`);
    const metadata=await sharp(bytes).metadata();
    const {width=1,height=1}=metadata,aspect=width/height;
    const targetH=Math.max(1,Math.round(Math.sqrt(10000/aspect))),targetW=Math.max(1,Math.round(targetH*aspect));
    // This path intentionally exactly reproduces the existing HSV64 control.
    const productionPixels=await sharp(bytes).ensureAlpha().resize(targetW,targetH,{fit:'fill'}).raw().toBuffer();
    const hsv64=hsvHistogram(productionPixels);
    // Advanced descriptors use equal-area sampling after orientation and sRGB conversion.
    const sample=await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().resize(128,128,{fit:'fill'}).raw().toBuffer();
    const features=extractSampleFeatures(sample);
    await sharp(bytes).rotate().resize(640,400,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toFile(asset.thumbnail);
    parentPort.postMessage({id:asset.id,document:{id:asset.id,sha256:actual,hsv64,hsv64_sqrt:hsv64.map(Math.sqrt),...features},metadata:{width,height,format:metadata.format,bytes:bytes.length}});
  } catch(error){parentPort.postMessage({id:asset.id,error:error.stack??String(error)});}
});
