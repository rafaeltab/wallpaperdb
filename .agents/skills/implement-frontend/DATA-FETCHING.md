# Data Fetching

All server state is managed by TanStack Query v5. There are two transports:

| Transport | Client | Used for | Env var |
|---|---|---|---|
| GraphQL | `graphql-request` | Wallpaper queries | `VITE_GATEWAY_URL` |
| REST | `fetch` | File uploads | `VITE_INGESTOR_URL` |

Both must be called through TanStack Query hooks. Components must be rendered inside `QueryClientProvider` (already wired in `App.tsx`).

## GraphQL Query Hook

Queries live in `src/lib/graphql/queries.ts`. The shared client is `src/lib/graphql/client.ts`.

```ts
// src/lib/graphql/queries.ts
import { gql } from 'graphql-request'

export const GET_MY_THING = gql`
  query GetMyThing($id: ID!) {
    thing(id: $id) {
      id
      name
    }
  }
`
```

```ts
// src/hooks/useMyThingQuery.ts
import { useQuery } from '@tanstack/react-query'
import { graphqlClient } from '@/lib/graphql/client'
import { GET_MY_THING } from '@/lib/graphql/queries'

interface GetMyThingResponse {
  thing: { id: string; name: string }
}

export function useMyThingQuery(id: string) {
  return useQuery({
    queryKey: ['thing', id],
    queryFn: () =>
      graphqlClient.request<GetMyThingResponse>(GET_MY_THING, { id }),
    enabled: !!id,
  })
}
```

## Infinite Scroll Query

```ts
import { useInfiniteQuery } from '@tanstack/react-query'
import { graphqlClient } from '@/lib/graphql/client'
import { SEARCH_WALLPAPERS } from '@/lib/graphql/queries'

export function useWallpaperInfiniteQuery(search: string) {
  return useInfiniteQuery({
    queryKey: ['wallpapers', search],
    queryFn: ({ pageParam }) =>
      graphqlClient.request(SEARCH_WALLPAPERS, { search, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.wallpapers.pageInfo.endCursor,
  })
}
```

## REST Mutation Hook

REST functions live in `src/lib/api/ingestor.ts`. Wrap them in `useMutation`:

```ts
// src/lib/api/ingestor.ts
export async function uploadFile(file: File): Promise<{ id: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${import.meta.env.VITE_INGESTOR_URL}/upload`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  return res.json()
}
```

```ts
// src/hooks/useUploadMutation.ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { uploadFile } from '@/lib/api/ingestor'

export function useUploadMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: uploadFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallpapers'] })
    },
  })
}
```

## Query Key Conventions

- `['wallpapers']` — wallpaper list
- `['wallpapers', id]` — single wallpaper
- `['wallpapers', search]` — filtered list

Invalidate by prefix: `queryClient.invalidateQueries({ queryKey: ['wallpapers'] })` invalidates all wallpaper queries.

## Loading and Error States

```tsx
const { data, isLoading, isError, error } = useMyThingQuery(id)

if (isLoading) return <MyThingSkeleton />
if (isError) return <div>Error: {error.message}</div>
```
