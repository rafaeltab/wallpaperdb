# Core 3 sign-in

Use the installed `useSignIn` types and the official [sign-in reference](https://clerk.com/docs/references/react/use-sign-in) for methods and errors.

Handle second-factor and client-trust verification separately. Finalization must account for pending session tasks and use the SDK redirect decoration so Safari session handling works.
