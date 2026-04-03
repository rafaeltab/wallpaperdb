# Testing

> For general test commands, coverage, and test tiers, see the `testing` skill.

Frontend tests use **Vitest v3** + **Testing Library** + **jsdom**. All test files live in `apps/web/test/` mirroring `src/`.

## Run Commands

```bash
make web-test           # Single-pass run
make web-test-watch     # Watch mode
pnpm --filter @wallpaperdb/web test:unit  # With coverage (no Make target yet)
```

## Global Mocks (test/setup.ts)

These are pre-configured and available in every test — no imports needed:

| Mock | Notes |
|---|---|
| `window.matchMedia` | Returns `false` for all queries |
| `ResizeObserver` | No-op |
| `IntersectionObserver` | Use `triggerIntersection(elements)` to fire callbacks |
| `DataTransfer` | Drag-and-drop simulation |
| `URL.createObjectURL` / `revokeObjectURL` | Returns `'mock-url'` |
| `navigator.clipboard` | Stub with `writeText` / `readText` |
| `navigator.share` | Stub |
| `caches` (Cache API) | In-memory stub |

## Rendering a Component

```tsx
import { render, screen } from '@testing-library/react'
import { MyComponent } from '@/components/MyComponent'

it('renders the title', () => {
  render(<MyComponent title="Hello" />)
  expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument()
})
```

## Query Priority (Testing Library)

Prefer queries in this order (most to least semantic):

1. `getByRole` — best; use `name` option to distinguish
2. `getByLabelText` — for form fields
3. `getByText` — for visible text
4. `getByTestId` — last resort; add `data-testid` only when nothing else works

## User Interactions

```tsx
import userEvent from '@testing-library/user-event'

it('calls onSubmit when form is submitted', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  render(<MyForm onSubmit={onSubmit} />)

  await user.type(screen.getByRole('textbox', { name: /name/i }), 'Alice')
  await user.click(screen.getByRole('button', { name: /submit/i }))

  expect(onSubmit).toHaveBeenCalledWith({ name: 'Alice' })
})
```

Prefer `userEvent` over `fireEvent` — it simulates real browser events (focus, pointer, keyboard).

## Async Queries

```tsx
// waitFor — retry assertion until it passes
await waitFor(() => expect(screen.getByText('Loaded')).toBeInTheDocument())

// findBy* — shorthand for waitFor + getBy*
const item = await screen.findByRole('listitem', { name: 'My Item' })
```

## Testing TanStack Query Hooks

Wrap with a fresh `QueryClient` per test to avoid state leaking:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useMyThingQuery } from '@/hooks/useMyThingQuery'

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

it('fetches the thing', async () => {
  vi.mocked(graphqlClient.request).mockResolvedValue({ thing: { id: '1', name: 'Test' } })

  const { result } = renderHook(() => useMyThingQuery('1'), {
    wrapper: makeWrapper(),
  })

  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data?.thing.name).toBe('Test')
})
```

## Testing with the Router

Wrap with `RouterProvider` using a `createMemoryHistory` for tests that need route context:

```tsx
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from '@/routeTree.gen'

function renderWithRouter(initialPath = '/') {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  return render(<RouterProvider router={router} />)
}
```

## Simulating IntersectionObserver

The global `triggerIntersection` helper is exposed from `test/setup.ts`:

```tsx
import { triggerIntersection } from '../setup'

it('loads more on scroll', async () => {
  render(<InfiniteList />)
  const sentinel = screen.getByTestId('load-more-sentinel')
  triggerIntersection([sentinel])
  await screen.findByText('Next page item')
})
```
