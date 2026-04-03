# Components

Component library is shadcn/ui, styling is Tailwind CSS v4. UI components live in `src/components/ui/`. Feature components go in `src/components/<feature>/`.

## Installing a shadcn Component via MCP

Use the shadcn MCP tools in this order:

### 1. Search for the component
```
shadcn_search_items_in_registries({ registries: ["@shadcn"], query: "date picker" })
```

### 2. Inspect files and dependencies
```
shadcn_view_items_in_registries({ items: ["@shadcn/date-picker"] })
```

### 3. Find usage examples
```
shadcn_get_item_examples_from_registries({ registries: ["@shadcn"], query: "date-picker-demo" })
```

### 4. Get the install command
```
shadcn_get_add_command_for_items({ items: ["@shadcn/date-picker"] })
```

### 5. Run the command in `apps/web/`
The tool returns a `pnpm dlx shadcn add ...` command. Run it from `apps/web/`.

### 6. Run the audit checklist
```
shadcn_get_audit_checklist()
```

## Already-Installed Components

24 components are in `src/components/ui/`. Check there before using the MCP — you may not need to install anything.

Common ones: `button`, `card`, `dialog`, `dropdown-menu`, `input`, `label`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `sonner`, `tooltip`.

## Styling with Tailwind v4

- Configuration is in `src/index.css` (no `tailwind.config.js` — v4 is CSS-first)
- Use the `cn()` helper for conditional classes:

```tsx
import { cn } from '@/lib/utils'

<div className={cn('base-class', isActive && 'active-class', className)} />
```

- Theme colors use CSS variables defined in `src/index.css`:
  ```
  --primary, --secondary, --background, --foreground, --muted, --accent, --destructive
  ```
  Reference them as `bg-primary`, `text-foreground`, etc.

- Dark mode is handled via `next-themes` — use `dark:` variants freely.

## Building a Feature Component

```tsx
import { cn } from '@/lib/utils'

interface MyCardProps {
  title: string
  className?: string
}

export function MyCard({ title, className }: MyCardProps) {
  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  )
}
```

## Component Variants with CVA

Use `class-variance-authority` when a component has multiple visual states:

```tsx
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('rounded-full px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground',
      secondary: 'bg-secondary text-secondary-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ variant, className, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
```

## Icons

Use `lucide-react`. Import by name:

```tsx
import { Upload, Search, X } from 'lucide-react'

<Upload className="size-4" />
```
