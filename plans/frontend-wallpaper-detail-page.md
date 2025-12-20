# Frontend: Wallpaper Detail Page

**Status**: Ready for Implementation  
**Date**: December 20, 2024  
**Route**: `/wallpapers/$wallpaperId`

---

## Overview

Create a wallpaper detail page that displays a wallpaper at maximum size with collapsible metadata panel. The page features responsive design, keyboard shortcuts, local-first downloads, and smart sharing.

### Key Features

- ✅ **Large wallpaper display** - Centered, aspect-ratio preserved, max size
- ✅ **Collapsible metadata panel** - Sheet component (right on desktop, bottom on mobile)
- ✅ **Mobile peek indicator** - "View Details" floating button when closed
- ✅ **Panel state persistence** - localStorage
- ✅ **Original variant default** - Always display highest quality first
- ✅ **Download dropdown** - All variants with resolution, format badges, "(original)" label
- ✅ **Smart share** - Native share on mobile, copy URL on desktop
- ✅ **Keyboard shortcuts** - I, D, S, Escape, ←→ (non-navigation)
- ✅ **Local-first downloads** - Cache API for performance
- ✅ **Loading states** - Skeleton components
- ✅ **Error states** - Alert components for not found / network errors
- ✅ **Shadcn/ui maximization** - 10+ components used throughout
- ✅ **Responsive design** - Mobile/desktop optimized
- ✅ **Accessibility** - ARIA labels, keyboard navigation, semantic HTML

---

## Layout Design

### Desktop (≥1024px)

```
┌─────────────────────────────────────────────────────────────┐
│  [Back Button] Wallpaper Details      [Toggle Panel Button] │
├─────────────────────────────┬───────────────────────────────┤
│                             │ <Sheet side="right">          │
│                             │                               │
│                             │  SheetHeader:                 │
│    Wallpaper Display        │    "Wallpaper Details"        │
│    (Maximum size,           │    [Close X]                  │
│     maintains aspect        │                               │
│     ratio, centered)        │  SheetContent (scrollable):   │
│                             │    • Metadata Cards           │
│                             │    • Variant Selector         │
│    [Viewing indicator]      │    • Keyboard Shortcuts       │
│                             │                               │
│    [Download ▼] [Share]     │                               │
└─────────────────────────────┴───────────────────────────────┘
```

### Mobile (<1024px)

```
┌───────────────────────────┐
│  [Back] Details  [Toggle] │
├───────────────────────────┤
│                           │
│    Wallpaper Display      │
│    (Full width, fills     │
│     available space)      │
│                           │
│    [Viewing indicator]    │
│                           │
│    [Download ▼] [Share]   │
│                           │
└───────────────────────────┘
            ↕
  [View Details ▲] (peek)
            ↕
┌───────────────────────────┐
│ <Sheet side="bottom">     │
│  Metadata panel slides up │
│  from bottom (85vh)       │
│  (scrollable, closed by   │
│   default on mobile)      │
└───────────────────────────┘
```

---

## Component Architecture

```
routes/wallpapers.$wallpaperId.tsx
├─ WallpaperDetailPage (main container)
│  ├─ Header (back button, title, panel toggle)
│  ├─ WallpaperDisplay (image viewer)
│  ├─ Viewing Indicator (current variant)
│  ├─ ActionBar (download dropdown, share button)
│  └─ Sheet (metadata panel)
│     └─ WallpaperMetadata
│        ├─ InfoCard (basic metadata)
│        ├─ CurrentDisplayCard (selected variant info)
│        ├─ VariantList (all available sizes/formats)
│        └─ KeyboardShortcuts (collapsible help)
```

---

## Shadcn/UI Components Used

1. **Sheet, SheetContent, SheetHeader, SheetTitle** - Metadata panel
2. **Card, CardHeader, CardTitle, CardDescription, CardContent** - Metadata sections
3. **Badge** - Format tags, dimension chips, labels
4. **Button** - All interactive actions
5. **Separator** - Visual dividers
6. **Tooltip, TooltipTrigger, TooltipContent** - Hover information
7. **Skeleton** - Loading states
8. **Alert, AlertTitle, AlertDescription** - Error messages
9. **DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator** - Download variant selector
10. **Kbd** - Keyboard shortcut display

---

## Files to Create

### 1. Hooks (3 files)

#### `src/hooks/usePersistentState.ts`
React hook that persists state to localStorage with JSON serialization.

**API**:
```tsx
const [state, setState] = usePersistentState<T>(key: string, defaultValue: T);
```

**Features**:
- Initial value from localStorage or defaultValue
- Auto-save to localStorage on state change
- Error handling for quota exceeded/private browsing

---

#### `src/hooks/use-media-query.ts`
React hook for responsive breakpoint detection.

**API**:
```tsx
const matches = useMediaQuery(query: string);
// Example: const isMobile = useMediaQuery('(max-width: 1024px)');
```

**Features**:
- Window.matchMedia wrapper
- Reactive to viewport changes
- Cleanup on unmount

---

#### `src/hooks/useWallpaperQuery.ts`
TanStack Query hook to fetch a single wallpaper by ID.

**API**:
```tsx
const { data, isLoading, error } = useWallpaperQuery(wallpaperId: string);
```

**Features**:
- Query key: `['wallpaper', wallpaperId]`
- Stale time: 5 minutes
- GC time: 10 minutes
- Retry: 1 attempt

---

### 2. Utilities (1 file)

#### `src/lib/utils/wallpaper.ts`
Formatting and helper functions for wallpaper data.

**Functions**:

```tsx
// Format bytes to human-readable (e.g., "2.5 MB")
formatFileSize(bytes: number): string

// Format aspect ratio (e.g., "16:9" or "1.78")
formatAspectRatio(ratio: number): string

// Format ISO date to readable (e.g., "Dec 20, 2024, 3:45 PM")
formatDate(dateString: string): string

// Truncate ID for display (e.g., "wlpr_01JFABC...")
truncateId(id: string): string

// Download variant (local-first with Cache API)
downloadVariant(variant: Variant): Promise<void>
```

**Download Strategy**:
1. Check Cache API for existing variant
2. If cached, use blob from cache
3. If not cached, fetch from network and cache
4. Trigger browser download with proper filename
5. Fallback: open in new tab if download fails
6. Show toast notifications (success/error)

---

### 3. GraphQL (1 modification)

#### `src/lib/graphql/queries.ts` (append)

```graphql
export const GET_WALLPAPER = gql`
  query GetWallpaper($id: ID!) {
    getWallpaper(id: $id) {
      wallpaperId
      userId
      uploadedAt
      updatedAt
      variants {
        width
        height
        aspectRatio
        format
        fileSizeBytes
        createdAt
        url
      }
    }
  }
`;
```

**Note**: Backend implementation handled separately (see gateway service plan).

---

### 4. Components (5 files)

#### `src/components/wallpaper-detail/WallpaperDisplay.tsx`

**Props**:
```tsx
interface WallpaperDisplayProps {
  variant: Variant;
  isLoading: boolean;
  onLoadComplete: () => void;
  showIndicator?: boolean;
  isOriginal?: boolean;
}
```

**Features**:
- Maximum size display with `object-contain`
- Maintains aspect ratio
- Skeleton while loading
- Optional variant indicator overlay (bottom-right)
- Smooth opacity transition on load

**Shadcn Components**: Skeleton, Badge

---

#### `src/components/wallpaper-detail/VariantList.tsx`

**Props**:
```tsx
interface VariantListProps {
  variants: Variant[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}
```

**Features**:
- Card with all available variants
- Format badge (JPEG, PNG, WebP)
- "Original" badge on first variant
- Highlight selected variant (default badge)
- "Set as Display" button (Eye icon)
- "Download" button for each variant
- Tooltip with full details on hover
- Separators between items

**Shadcn Components**: Card, Badge, Button, Separator, Tooltip

---

#### `src/components/wallpaper-detail/WallpaperMetadata.tsx`

**Props**:
```tsx
interface WallpaperMetadataProps {
  wallpaper: Wallpaper;
  selectedVariantIndex: number;
  onVariantSelect: (index: number) => void;
}
```

**Features**:
- SheetHeader with title
- **Information Card**: Wallpaper ID (with copy button), upload date, updated date, user ID
- **Current Display Card**: Dimensions badge, format badge, aspect ratio badge, file size
- **VariantList component**
- **Keyboard Shortcuts**: Collapsible `<details>` element with shortcuts help

**Shadcn Components**: SheetHeader, SheetTitle, Card, Badge, Button, Separator, Tooltip, Kbd

**Keyboard Shortcuts Display**:
- Uses native `<details>` element (collapsed by default)
- Keyboard icon + "Keyboard shortcuts" label
- Grid layout (2 columns) with kbd elements
- Small, muted colors, unobtrusive

---

#### `src/components/wallpaper-detail/WallpaperDetailSkeleton.tsx`

**Features**:
- Full-page loading state
- Header skeleton (back button, title, toggle)
- Large image skeleton
- Action bar skeleton (download, share buttons)
- Matches final layout structure

**Shadcn Components**: Skeleton

---

#### `src/components/wallpaper-detail/index.ts`

Barrel export file for all wallpaper-detail components.

```tsx
export { WallpaperDisplay } from './WallpaperDisplay';
export { WallpaperMetadata } from './WallpaperMetadata';
export { VariantList } from './VariantList';
export { WallpaperDetailSkeleton } from './WallpaperDetailSkeleton';
```

---

### 5. Route (1 file)

#### `src/routes/wallpapers.$wallpaperId.tsx`

**Main route component integrating all features.**

**State Management**:
```tsx
// Panel state (persisted to localStorage)
const [isPanelOpen, setIsPanelOpen] = usePersistentState('wallpaper-detail-panel-open', true);

// Responsive
const isMobile = useMediaQuery('(max-width: 1024px)');

// Variant selection (always start with original at index 0)
const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);

// Image loading
const [isImageLoading, setIsImageLoading] = useState(true);

// Data fetching
const { data: wallpaper, isLoading, error } = useWallpaperQuery(wallpaperId);
```

**Effects**:
- Auto-collapse panel on mobile (useEffect on isMobile change)
- Reset image loading when variant changes
- Keyboard shortcuts listener (I, D, S, Escape, ←, →)

**Handlers**:

```tsx
// Share: Native share on mobile, copy URL on desktop
handleShare(): Promise<void>

// Download variant (called from dropdown menu items)
handleDownloadVariant(variant: Variant): void
```

**Layout Structure**:
1. **Header**: Back button, title, panel toggle button
2. **Main Content**: WallpaperDisplay component
3. **Viewing Indicator**: Small centered display showing current variant (format, dimensions, "original" badge)
4. **Action Bar**: Download dropdown + Share button
5. **Sheet Panel**: WallpaperMetadata (responsive side)
6. **Mobile Peek**: Floating "View Details" button when panel closed

**Download Dropdown**:
- Button text: "Download original"
- Dropdown shows all variants
- Each item: Format badge + resolution + file size
- "(original)" suffix on first item
- "viewing" badge on currently displayed variant
- Click item to download that variant

**Error States**:
- 404 Not Found: Alert with back to gallery button
- Network Error: Alert with retry button

**Keyboard Shortcuts**:
- `I` - Toggle panel
- `D` - Download current variant
- `S` - Share
- `Escape` - Close panel (if open)
- `←` - Previous variant
- `→` - Next variant

**Accessibility**:
- ARIA labels on all interactive elements
- Semantic HTML (header, main)
- Keyboard navigation
- Screen reader support via sr-only classes

**Shadcn Components**: Sheet, Button, Alert, Badge, DropdownMenu (all subcomponents), Skeleton (via WallpaperDetailSkeleton)

---

## Implementation Order

Follow this sequence for clean, testable implementation:

### Phase 1: Utilities & Hooks (No Dependencies)
1. ✅ `src/hooks/usePersistentState.ts`
2. ✅ `src/hooks/use-media-query.ts`
3. ✅ `src/lib/utils/wallpaper.ts`

### Phase 2: GraphQL
4. ✅ `src/lib/graphql/queries.ts` (add GET_WALLPAPER)
5. ✅ `src/hooks/useWallpaperQuery.ts`

### Phase 3: Components (Bottom-Up)
6. ✅ `src/components/wallpaper-detail/WallpaperDetailSkeleton.tsx`
7. ✅ `src/components/wallpaper-detail/WallpaperDisplay.tsx`
8. ✅ `src/components/wallpaper-detail/VariantList.tsx`
9. ✅ `src/components/wallpaper-detail/WallpaperMetadata.tsx`
10. ✅ `src/components/wallpaper-detail/index.ts`

### Phase 4: Route (Integrates Everything)
11. ✅ `src/routes/wallpapers.$wallpaperId.tsx`

### Phase 5: Testing
12. ✅ Manual testing checklist (see below)

---

## Testing Checklist

### Desktop Testing
- [ ] Panel opens/closes with toggle button
- [ ] Panel state persists across page reload
- [ ] Panel opens on right side
- [ ] Keyboard shortcut `I` toggles panel
- [ ] Download dropdown shows all variants correctly
- [ ] "(original)" label appears on first variant
- [ ] "viewing" badge appears on current variant
- [ ] Download triggers browser download
- [ ] Share copies URL to clipboard and shows toast
- [ ] Keyboard shortcut `D` downloads current variant
- [ ] Keyboard shortcut `S` shares (copies URL)
- [ ] Arrow keys (←→) switch between variants
- [ ] Escape closes panel when open
- [ ] Variant switching updates "Viewing" indicator
- [ ] Image loads with smooth transition
- [ ] Variant info in metadata updates correctly
- [ ] Copy wallpaper ID button works

### Mobile Testing
- [ ] Panel closed by default on mobile
- [ ] "View Details" peek button visible when closed
- [ ] Clicking peek button opens panel
- [ ] Panel slides up from bottom (85vh height)
- [ ] Panel has rounded top corners
- [ ] Share button triggers native share dialog
- [ ] Download dropdown works on mobile
- [ ] Keyboard shortcuts work (if using external keyboard)
- [ ] Panel state persists (but auto-collapses on load)

### Error State Testing
- [ ] Invalid wallpaperId shows 404 error
- [ ] 404 error has "Back to Gallery" button
- [ ] Network error shows retry button
- [ ] Error alerts use destructive variant
- [ ] Loading state shows skeleton

### Responsive Testing
- [ ] Resize window from desktop to mobile
- [ ] Panel switches from right to bottom
- [ ] Panel auto-collapses when entering mobile viewport
- [ ] Peek indicator appears on mobile
- [ ] All touch interactions work

### Accessibility Testing
- [ ] Tab navigation works through all interactive elements
- [ ] ARIA labels present on icon-only buttons
- [ ] Screen reader announces panel state changes
- [ ] Keyboard shortcuts don't interfere with form inputs
- [ ] Focus visible on all interactive elements

---

## Feature Decisions

### 1. Share Functionality
- **Desktop**: Copy URL to clipboard, show toast
- **Mobile**: Use native `navigator.share()` API with title, text, url
- **Fallback**: If native share fails (user cancels), copy to clipboard

### 2. Download Button
- **Default Action**: Always downloads original (highest quality)
- **Button Text**: "Download original" (clear to user)
- **Dropdown**: Shows all variants with format badge, resolution, file size
- **Variant Indicators**: "(original)" suffix, "viewing" badge

### 3. Current Variant Indicator
- **Placement**: Centered below image, above action bar
- **Content**: Format badge + dimensions + "original" badge (if applicable)
- **Style**: Small, muted text, unobtrusive
- **Alternative**: Could be overlay on image (bottom-right), but centered is less intrusive

### 4. Keyboard Shortcuts
- **Help Display**: Collapsible `<details>` element at bottom of metadata panel
- **Icon**: Keyboard icon from lucide-react
- **Style**: Very small text, muted colors, collapsed by default
- **Shortcuts**: I, D, S, Escape, ←, →
- **Exclusion**: No navigation shortcuts (no routing changes)

### 5. Sheet Behavior
- **Desktop**: Right side, max-w-md to lg
- **Mobile**: Bottom, 85vh height, rounded top corners
- **Default State**: Open on desktop, closed on mobile
- **Persistence**: localStorage key `wallpaper-detail-panel-open`
- **Peek Indicator**: Floating button on mobile when closed
- **Drag Behavior**: Use default shadcn Sheet behavior (no custom handlers)

### 6. Variant Selection
- **Default**: Always start with original (index 0)
- **Switching**: Via VariantList buttons or keyboard arrows
- **Indicator**: "Viewing" section shows current variant details
- **Download Dropdown**: Highlights current variant with "viewing" badge

### 7. Local-First Downloads
- **Strategy**: Check Cache API → Use cached blob → Fetch from network → Cache → Download
- **Cache Name**: `'wallpaper-variants'`
- **Filename Format**: `wallpaper-{width}x{height}.{format}`
- **Fallback**: Open in new tab if download fails
- **Notifications**: Toast on success/error

---

## Backend Dependencies

This frontend implementation assumes the following backend query exists:

```graphql
type Query {
  getWallpaper(id: ID!): Wallpaper
}
```

**Backend Implementation**: Separate plan/task for gateway service to add this query.

**Data Structure**: Uses existing `Wallpaper` type from `searchWallpapers` query.

---

## Future Enhancements

These are **NOT** included in this implementation but are planned for future iterations:

1. **Tags Display**: Card showing wallpaper tags (once tagging service is implemented)
2. **Color Features**: Card showing dominant colors, color palette (once color enrichment service is implemented)
3. **Image Zoom/Lightbox**: Click to open fullscreen modal with zoom controls
4. **Similar Wallpapers**: Recommendations based on tags, colors, dimensions
5. **Edit/Delete Actions**: Owner-only actions (requires auth)
6. **Download Analytics**: Track download counts per variant
7. **Share to Social Media**: Direct sharing to Twitter, Reddit, etc.
8. **Keyboard Shortcut Customization**: User-configurable shortcuts
9. **Variant Comparison**: Side-by-side view of different variants
10. **Quality Metrics**: Display quality scores from quality enrichment service

---

## Notes

- **No Grid Navigation Changes**: Per requirements, this plan does NOT modify `WallpaperGrid.tsx` or `routes/index.tsx`. Navigation integration will be handled in a separate task.
- **Lucide Icons Used**: ArrowLeft, Download, Share, PanelRight, AlertCircle, ChevronDown, Info, ChevronUp, Eye, Copy, Keyboard
- **Sonner Toast**: Already in project, used for notifications (copy, download, share)
- **Cache API**: Browser support is excellent (98%+ globally), graceful fallback for older browsers
- **TanStack Router**: Using file-based routing with dynamic params (`$wallpaperId`)

---

## Success Criteria

This implementation will be considered complete when:

✅ Page loads successfully with valid wallpaper ID  
✅ Error states display correctly (404, network errors)  
✅ Metadata panel toggles open/closed  
✅ Panel state persists across page reloads  
✅ Responsive behavior works (desktop right panel, mobile bottom sheet)  
✅ Mobile peek indicator shows when panel closed  
✅ Download dropdown shows all variants with correct labels  
✅ Share functionality works (native on mobile, copy on desktop)  
✅ Keyboard shortcuts all function correctly  
✅ Variant switching works via UI and keyboard  
✅ Current variant indicator displays accurately  
✅ All shadcn/ui components render properly  
✅ Loading states display during data fetch  
✅ Image loads with smooth transition  
✅ Accessibility requirements met (ARIA, keyboard nav, semantic HTML)  
✅ No console errors or warnings  

---

**Plan Status**: ✅ Complete and ready for implementation  
**Last Updated**: December 20, 2024
