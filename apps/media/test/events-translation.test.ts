import { expect, it } from 'vitest';
import { headers } from 'nats';
import { translateEvent } from '../src/adapters/events/index.js';
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const wallpaper = { id:'wp',userId:'user',fileType:'image',mimeType:'image/png',fileSizeBytes:20,width:2,height:2,aspectRatio:1,storageBucket:'wallpapers',storageKey:'wp.png',originalFilename:'wp.png',uploadedAt:'2026-09-24T10:00:00.000Z' };
it('translates a structured upload CloudEvent without losing its occurrence and correlation',()=>{
 expect(translateEvent('wallpaper.uploaded',encode({specversion:'1.0',source:'https://wallpaperdb/ingestor',id:'event-1',type:'wallpaper.uploaded',time:'2026-09-24T10:00:00.000Z',datacontenttype:'application/json',correlationid:'flow-1',data:{wallpaper}}))).toEqual({kind:'wallpaper',occurrence:{source:'https://wallpaperdb/ingestor',id:'event-1'},occurredAt:'2026-09-24T10:00:00.000Z',correlationId:'flow-1',wallpaper:{id:'wp',mimeType:'image/png',fileSizeBytes:20,width:2,height:2,storageBucket:'wallpapers',storageKey:'wp.png',createdAt:'2026-09-24T10:00:00.000Z'}});
});
it('translates binary variant events with producer identity and the variant MIME type',()=>{
 const header=headers();
 for(const [key,value] of Object.entries({'ce-specversion':'1.0','ce-source':'https://wallpaperdb/variant-generator','ce-id':'variant-1','ce-type':'wallpaper.variant.uploaded','ce-time':'2026-09-24T10:00:00.000Z',traceparent:'00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'})) header.set(key,value);
 const result=translateEvent('wallpaper.variant.uploaded',encode({eventId:'variant-1',eventType:'wallpaper.variant.uploaded',timestamp:'2026-09-24T10:00:00.000Z',variant:{wallpaperId:'wp',width:1,height:1,aspectRatio:1,format:'image/webp',fileSizeBytes:10,storageBucket:'wallpapers',storageKey:'variant.webp',createdAt:'2026-09-24T10:00:00.000Z'}}),header);
 expect(result).toMatchObject({kind:'variant',occurrence:{source:'https://wallpaperdb/variant-generator',id:'variant-1'},variant:{mimeType:'image/webp',storageKey:'variant.webp'},traceparent:'00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'});
});
it('rejects malformed payloads, mismatched event types, and incomplete binary envelopes',()=>{
 const event={eventId:'event-1',eventType:'wallpaper.uploaded',timestamp:'2026-09-24T10:00:00.000Z',wallpaper};
 expect(translateEvent('wallpaper.uploaded',new Uint8Array([255]))).toBeUndefined();
 expect(translateEvent('wallpaper.uploaded',encode({...event,wallpaper:{...wallpaper,width:0}}))).toBeUndefined();
 expect(translateEvent('profile.created',encode(event))).toBeUndefined();
 const header=headers(); header.set('ce-source','https://wallpaperdb/ingestor');
 expect(translateEvent('wallpaper.uploaded',encode(event),header)).toBeUndefined();
});
