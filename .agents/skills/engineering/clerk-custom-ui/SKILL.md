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

# Custom Clerk UI

Inspect the application's Clerk provider and installed SDK before changing authentication or appearance. Core 2 and Core 3 have different hook contracts. Use references matching the installed version.

## Custom flows

- Core 2: [sign-in](core-2/custom-sign-in.md) and [sign-up](core-2/custom-sign-up.md).
- Core 3: [sign-in](core-3/custom-sign-in.md), [sign-up](core-3/custom-sign-up.md), and [conditional display](core-3/show-component.md).

## Appearance

Read the official [appearance documentation](https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/overview) for themes, variables, component styling, and layout options. Check the installed SDK's imports instead of copying examples for another major version.

When the application uses shadcn, apply Clerk's matching theme before further customization unless the user chooses another theme. Verify sign-in, verification, pending session tasks, errors, and redirect behavior through the application's existing authentication flow.
