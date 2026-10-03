import { expect, it } from 'vitest';
import { acceptedUploads, queuePresentation } from '@/features/upload-queue';
it('accepts supported files within size and count limits while explaining rejected entries', () => {
  const files=[{type:'image/png',size:1},{type:'image/gif',size:1},{type:'image/jpeg',size:51*1024*1024},{type:'image/webp',size:1}];
  expect(acceptedUploads(files,1)).toEqual({files:[files[0]],rejectionMessage:'Only JPEG, PNG, and WebP images are supported. Images must be 50 MiB or smaller.'});
  expect(acceptedUploads(files,0).files).toEqual([]);
  expect(acceptedUploads([],2)).toEqual({files:[],rejectionMessage:null});
});
it('auto-dismisses only successful settled batches and never stopped, paused or failed queues', () => {
  const state={files:[{status:'success' as const}],isPaused:false,isStopped:false};
  expect(queuePresentation(state)).toMatchObject({isComplete:true,autoDismiss:true});
  expect(queuePresentation({...state,isStopped:true}).autoDismiss).toBe(false);
  expect(queuePresentation({...state,isPaused:true}).autoDismiss).toBe(false);
  expect(queuePresentation({...state,files:[{status:'duplicate'}]}).autoDismiss).toBe(false);
  expect(queuePresentation({...state,files:[{status:'failed'}]}).autoDismiss).toBe(false);
});
