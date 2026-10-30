# `<Show>` Component

The `<Show>` component conditionally renders content based on authentication state, roles, permissions, billing plans, and features.

Core 2 uses `<SignedIn>`, `<SignedOut>`, and `<Protect>` instead. See [Migration from Core 2](#migration-from-core-2).

## Import

```typescript
import { Show } from '@clerk/nextjs'       // Next.js
import { Show } from '@clerk/react'         // React
import { Show } from '@clerk/react-router'  // React Router
import { Show } from '@clerk/expo'          // Expo
```

## Props

| Prop | Type | Description |
|------|------|-------------|
| `when` | `string \| object \| function` | Condition for rendering children |
| `fallback?` | `ReactNode` | Content shown when condition fails |
| `treatPendingAsSignedOut?` | `boolean` | Treat pending sessions as signed-out (default: `true`) |

## `when` Prop Variants

### Authentication State

```tsx
<Show when="signed-in">
  <p>Welcome back!</p>
</Show>

<Show when="signed-out">
  <p>Please sign in.</p>
</Show>
```

### Role Check

```tsx
<Show when={{ role: 'org:admin' }}>
  <AdminPanel />
</Show>
```

### Permission Check

```tsx
<Show when={{ permission: 'org:billing:manage' }}>
  <BillingSettings />
</Show>
```

### Billing Feature Check

```tsx
<Show when={{ feature: 'widgets' }}>
  <WidgetBuilder />
</Show>
```

### Billing Plan Check

```tsx
<Show when={{ plan: 'gold' }}>
  <PremiumContent />
</Show>
```

### Custom Condition (Function)

```tsx
<Show when={(has) => has({ role: 'org:admin' }) || has({ permission: 'org:billing:manage' })}>
  <SettingsPanel />
</Show>
```

## Fallback Content

```tsx
<Show when="signed-in" fallback={<p>Please sign in to continue.</p>}>
  <Dashboard />
</Show>
```

## Session Tasks and Pending State

Pending sessions have incomplete tasks. They count as signed out by default; set `treatPendingAsSignedOut={false}` to show task completion UI.

```tsx
// Default: pending sessions are treated as signed-out
<Show when="signed-in" treatPendingAsSignedOut>
  <Dashboard />
</Show>

// Treat pending sessions as signed-in (e.g., to show task completion UI)
<Show when="signed-in" treatPendingAsSignedOut={false}>
  <TaskCompletionFlow />
</Show>
```

## Security Caveat

`<Show>` only hides content visually; it remains in browser source. Protect sensitive data by verifying authentication server-side with `auth()` or `auth.protect()` in middleware.

## Migration from Core 2

| Core 2 | Current |
|--------|---------|
| `<SignedIn>` | `<Show when="signed-in">` |
| `<SignedOut>` | `<Show when="signed-out">` |
| `<Protect role="org:admin">` | `<Show when={{ role: 'org:admin' }}>` |
| `<Protect permission="org:billing:manage">` | `<Show when={{ permission: 'org:billing:manage' }}>` |
| `<Protect condition={(has) => expr}>` | `<Show when={(has) => expr}>` |
| `<Protect fallback={...}>` | `<Show when={...} fallback={...}>` |
| *(no equivalent)* | `<Show when={{ feature: 'widgets' }}>` |
| *(no equivalent)* | `<Show when={{ plan: 'gold' }}>` |

## Docs

- [Show component reference](https://clerk.com/docs/components/control/show)
