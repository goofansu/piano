# Provider sign-in

Pi runs the authorization and saves credentials in its usual `auth.json`. Piano keeps tokens and
pasted codes out of session history, the registry and browser storage.

## Sign in to a remote Piano

When Piano runs on another machine, choose a device-code or copy-code method. A browser method
needs a callback that reaches the Piano server. Radius's browser method has that requirement, and
its device-code method works remotely. See [Radius setup](radius-setup.md) for the Radius section.

Provider accounts and MCP servers use the same [sign-in dialog](../web/src/shared/sign-in/SignInDialog.tsx).
Each feature supplies its own endpoint so opening or cancelling a dialog operates on the right sign-in attempt.

## API keys

Adding another single-key provider requires a catalog entry in `shared/features/providers/providerApiKeys.ts`
(kept alphabetical) and a bundled logo, not another settings flow.

## Verification

Scratch Piano is signed out: `test/features/providers/ProviderLogin.test.ts`, `test/SignInAttempts.test.ts` and the
[Settings recipe](../.agents/skills/verify-piano/features/settings-other.md) do not show a real
provider accepting an OAuth sign-in or an API key.
