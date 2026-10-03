import { expect, it } from 'vitest';
import { feedPresentation } from '@/features/browse';
it('distinguishes initial errors from later errors while preserving cached results', () => {
 const query={error:Error('Request failed'),failureReason:null,itemCount:0,isLoading:false,isFetchNextPageError:false,isFetchingNextPage:false};
 expect(feedPresentation(query)).toMatchObject({initialError:true,showResults:false,retryTarget:'refresh'});
 expect(feedPresentation({...query,itemCount:2,isFetchNextPageError:true})).toMatchObject({initialError:false,showResults:true,retryTarget:'next-page'});
 expect(feedPresentation({...query,itemCount:2,isFetchingNextPage:true})).toMatchObject({retryTarget:'next-page'});
 expect(feedPresentation({...query,error:null,isLoading:true})).toMatchObject({initialError:false,showResults:true});
 expect(feedPresentation({...query,error:null})).toMatchObject({initialError:false,showResults:false});
 expect(feedPresentation({...query,error:null,failureReason:query.error}).error).toBe(query.error);
});
