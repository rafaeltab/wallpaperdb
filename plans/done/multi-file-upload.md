# Multi-File Upload Feature Plan

## Summary
Add multi-file upload with background processing, progress toast, and smart error handling for rate limits, failures, and duplicates.

## Architecture

**State Management:** React Context + useReducer (follows existing ThemeProvider pattern)
**Upload Strategy:** Sequential with rate-limit awareness (pause on 429, resume after Retry-After)
**Progress UI:** Persistent toast with expandable file details
**File Limit:** 50 files max (configurable constant)

## UX Decisions

- **Navigation**: User stays on upload page after selecting files, but can manually navigate away. Uploads continue in background.
- **Toast**: Clickable to navigate back to upload page. Shows progress regardless of current page.
- **Completion**: Auto-dismiss after 5s if all succeeded. Stay visible if there are failures or duplicates to review.
- **No auto-redirect**: Remove current auto-navigate to home behavior.

## Files to Create

### 1. `src/contexts/upload-queue-context.tsx`
Upload queue state machine with:
- File states: `pending` → `uploading` → `success`/`failed`/`duplicate`
- Queue states: `isProcessing`, `isPaused`, `pausedUntil`
- Actions: `addFiles`, `clearCompleted`, `retryFailed`, `cancelAll`
- Auto-processes pending files via useEffect
- Pauses on rate limit, resumes after `Retry-After` seconds
- Configurable `MAX_FILES_PER_BATCH = 50` constant at top of file

### 2. `src/components/upload/upload-queue-toast.tsx`
Custom toast component showing:
- Header: "Uploading 3/10 files" or "Paused (resuming in 45s)" or "Upload complete"
- Progress bar (overall completion)
- Summary badges: "5 uploaded", "2 duplicates", "1 failed"
- Expandable file list with individual status
- Action buttons: "Retry failed", "Dismiss"
- **Clickable**: Clicking toast navigates to `/upload` page
- **Auto-dismiss**: Closes after 5s if all succeeded; stays open if failures/duplicates exist

### 3. `src/components/upload/upload-drop-zone.tsx`
Reusable multi-file drop zone:
- `multiple` attribute on file input
- Drag-drop support for multiple files
- Visual feedback and validation

## Files to Modify

### 1. `src/lib/api/ingestor.ts`
Add `uploadWallpaperWithDetails()` that returns structured result:
```typescript
type UploadResult = {
  success: boolean;
  isDuplicate: boolean;  // status === 'already_uploaded'
  response?: UploadResponse;
  error?: {
    type: 'rate_limit' | 'validation' | 'server' | 'network';
    message: string;
    retryAfter?: number;  // from Retry-After header
  };
}
```

### 2. `src/App.tsx`
Wrap app with `<UploadQueueProvider>` and add `<UploadQueueToastManager>` alongside `<Toaster>`

### 3. `src/routes/upload.tsx`
- Replace single-file logic with `<UploadDropZone>`
- Call `addFiles()` from context when files selected
- Show inline queue status (current upload progress, file list)
- Remove auto-navigate to home on success
- Keep page functional for tracking progress or adding more files

## Error Handling

| Error Type | Behavior |
|------------|----------|
| **Rate Limit (429)** | Pause queue, show countdown in toast, resume after `Retry-After` |
| **Duplicate (200)** | Mark as `duplicate`, count toward progress, show in summary |
| **Validation (400/413)** | Mark as `failed`, show error, allow retry |
| **Server/Network (5xx)** | Mark as `failed`, allow retry |

## Implementation Steps

1. Set up testing infrastructure (Vitest + React Testing Library)
2. Create `upload-queue-context.tsx` with reducer and provider
3. Update `ingestor.ts` with enhanced error handling
4. Create `upload-queue-toast.tsx` with progress UI
5. Create `upload-drop-zone.tsx` component
6. Update `App.tsx` to add provider
7. Update `upload.tsx` to use new components
8. Write tests (see Testing Strategy below)

## Testing Strategy

### Setup Required (web app has no testing infrastructure)
Add to `apps/web/`:
- `vitest.config.ts` - test configuration
- `test/setup.ts` - test setup (jsdom, jest-dom matchers)
- Dependencies: `vitest`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/jest-dom`, `jsdom`
- Add `test` script to package.json
- Add `make web-test` to Makefile

### Unit Tests

**1. Upload Queue Reducer** (`test/contexts/upload-queue-reducer.test.ts`)
- ADD_FILES: adds files with pending status
- ADD_FILES: enforces MAX_FILES_PER_BATCH limit
- START_UPLOAD: transitions file to uploading
- UPLOAD_SUCCESS: marks file as success
- UPLOAD_FAILED: marks file as failed with error
- UPLOAD_DUPLICATE: marks file as duplicate
- PAUSE_QUEUE: sets isPaused and pausedUntil
- RESUME_QUEUE: clears pause state
- CLEAR_COMPLETED: removes success/duplicate files
- RETRY_FAILED: moves failed files back to pending

**2. API Client** (`test/lib/api/ingestor.test.ts`)
- Returns success result for 200 with `status: 'processing'`
- Returns duplicate result for 200 with `status: 'already_uploaded'`
- Returns rate_limit error for 429 with retryAfter from header
- Returns validation error for 400/413
- Returns server error for 500
- Returns network error on fetch failure

### Component Tests

**3. Upload Drop Zone** (`test/components/upload/upload-drop-zone.test.tsx`)
- Renders drop zone UI
- Calls onFilesSelected when files selected via input
- Calls onFilesSelected when files dropped
- Respects maxFiles limit
- Shows drag-active state during drag-over

**4. Upload Queue Toast** (`test/components/upload/upload-queue-toast.test.tsx`)
- Shows correct header based on state (uploading, paused, complete)
- Shows progress bar with correct value
- Shows summary badges for each file status
- Expands to show file list when clicked
- Calls navigation when toast clicked
- Shows/hides action buttons appropriately

### Integration Tests

**5. Upload Queue Flow** (`test/contexts/upload-queue-context.test.tsx`)
- Processes files sequentially
- Pauses on rate limit and resumes after delay
- Handles mixed results (success, duplicate, failure)
- Supports retry of failed files
- Clears completed files

### Mock Strategy
- Mock `fetch` for API responses
- Mock `useRouter` for navigation assertions
- Use fake timers for rate limit delay testing

## Key UX Details

- **Background uploads**: User can navigate away, toast persists and is clickable to return to upload page
- **Rate limit**: Queue pauses, shows "Paused (resuming in Xs)", auto-resumes
- **Duplicates**: Separate from failures, shows "X images were already uploaded"
- **Failures**: "Retry failed" button to retry only failed files
- **Completion**: Auto-dismiss after 5s if all succeeded; stays visible if failures/duplicates exist
- **File limit**: 50 files max per batch (configurable constant `MAX_FILES_PER_BATCH`)
