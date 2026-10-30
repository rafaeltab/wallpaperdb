---
name: clerk-custom-ui
description: Custom authentication flows and component appearance - hooks (useSignIn,
  useSignUp), themes, colors, fonts, CSS. Use for custom sign-in/sign-up flows, appearance
  styling, visual customization, branding.
allowed-tools: WebFetch
license: MIT
metadata:
  author: clerk
  version: 2.3.0
---

# Custom UI

Wrap the app in `ClerkProvider`; see `clerk-setup`. Check the SDK version in `package.json` against the `clerk` skill's version table before choosing custom flow references.

## What Do You Need?

Use hooks for custom authentication flows or the appearance prop for pre-built components.

## Custom Flow References

| Task | Core 2 | Current |
|------|--------|---------|
| Custom sign-in (useSignIn) | `core-2/custom-sign-in.md` | `core-3/custom-sign-in.md` |
| Custom sign-up (useSignUp) | `core-2/custom-sign-up.md` | `core-3/custom-sign-up.md` |
| `<Show>` component | *(use `<SignedIn>`, `<SignedOut>`, `<Protect>`)* | `core-3/show-component.md` |

## Appearance Customization

Applies to Core 2 and the current SDK.

### Component Customization Options

| Task | Documentation |
|------|---------------|
| Appearance prop overview | https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/overview |
| Options (structure, logo, buttons) | https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/layout |
| Themes (pre-built dark/light) | https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/themes |
| Variables (colors, fonts, spacing) | https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/variables |
| CAPTCHA configuration | https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/captcha |
| Bring your own CSS | https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/bring-your-own-css |

### Appearance Pattern

```typescript
<SignIn
  appearance={{
    variables: {
      colorPrimary: '#0000ff',
      borderRadius: '0.5rem',
    },
    options: {
      logoImageUrl: '/logo.png',
      socialButtonsVariant: 'iconButton',
    },
  }}
/>
```

### variables (colors, typography, borders)

| Property | Description |
|----------|-------------|
| `colorPrimary` | Primary color throughout |
| `colorBackground` | Background color |
| `borderRadius` | Border radius (default: `0.375rem`) |

`colorRing` and `colorModalBackdrop` render at full opacity; use `rgba()` for transparency. Core 2 rendered them at 15% opacity by default.

### options (structure, logo, social buttons)

| Property | Description |
|----------|-------------|
| `logoImageUrl` | URL to custom logo |
| `socialButtonsVariant` | `'blockButton'` \| `'iconButton'` \| `'auto'` |
| `socialButtonsPlacement` | `'top'` \| `'bottom'` |
| `showOptionalFields` | Show optional fields (default: `false`) |

In Core 2, use `layout` instead of `options`; `showOptionalFields` defaulted to `true`.

### Themes

Install `@clerk/ui` for themes.

```typescript
import { dark } from '@clerk/ui/themes'

<ClerkProvider appearance={{ theme: dark }} />
```

In Core 2, install and import themes from `@clerk/themes` instead.

For stacked themes, the last theme takes precedence:

```typescript
import { dark, neobrutalism } from '@clerk/ui/themes'

<ClerkProvider appearance={{ theme: [dark, neobrutalism] }} />
```

The default theme respects CSS `color-scheme` for light/dark mode.

**Available themes:** `dark`, `neobrutalism`, `shadcn`, `simple`

#### shadcn Theme

If the project has `components.json`, apply the shadcn theme before other customization unless the user requests another theme.

```typescript
import { shadcn } from '@clerk/ui/themes'

<ClerkProvider appearance={{ theme: shadcn }} />
```

Also import shadcn CSS in your global styles:
```css
@import 'tailwindcss';
@import '@clerk/ui/themes/shadcn.css';
```

> **Core 2 ONLY (skip if current SDK):** Import from `@clerk/themes` and `@clerk/themes/shadcn.css`:
> ```typescript
> import { shadcn } from '@clerk/themes'
> ```
> ```css
> @import '@clerk/themes/shadcn.css';
> ```

## Workflow

1. Identify customization needs (custom flow or appearance)
2. For custom flows: check SDK version → read appropriate `core-2/` or `core-3/` reference
3. For appearance: WebFetch the appropriate documentation from table above
4. Apply appearance prop to your Clerk components or build custom flow with hooks

## Common Pitfalls

Use `colorPrimary`, not `primaryColor`. Apply styling through the appearance prop unless using bring-your-own-css. Hook APIs differ between Core 2 and the current SDK; use the matching reference above.

## See Also

- `clerk-setup` - Initial Clerk install
- `clerk-nextjs-patterns` - Next.js patterns
- `clerk-orgs` - B2B organizations
