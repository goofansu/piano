# Provider sign-in

Piano signs in to model providers through Pi. To start, open **Settings** at the bottom of the
sidebar and click **Sign in** next to a provider under **Providers**. You can also reach Settings
through Mod+K or `/settings`. Sign-in needs no folder or model, and it is not a composer command.

Pi runs the authorization and saves credentials in its usual `auth.json`. Piano keeps tokens and
pasted codes out of session history, the registry and browser storage.

## Sign in to a remote Piano

When Piano runs on another machine, choose a device-code or copy-code method. A browser method
needs a callback that reaches the Piano server. Radius's browser method has that requirement, and
its device-code method works remotely. See [Radius setup](radius-setup.md) for the Radius section.

## Resume or cancel a sign-in

Closing or reloading the dialog keeps an active sign-in. To resume it, go back to
**Settings → Providers** and click **Sign in**. To stop it, click **Cancel**. An attempt
expires after 15 minutes or when Piano stops.

## API keys

Under **Settings → Providers → API Keys**, choose **Add key** for DeepSeek, Fireworks, Google
(a Gemini API key), OpenCode Go, OpenCode Zen or Vercel AI Gateway, paste the key and **Save**. The
row shows **Saved** after Pi stores it; this does not validate the key with the provider. Pi keeps a
saved key per provider, so an OpenCode key used for both Go and Zen is saved in each row. Its menu offers **Replace key** and **Remove key**, with
confirmation before removal and a toast after each change. Keys are never read back into the
browser.

Removal deletes only the saved key on this machine. It does not revoke it at the provider or
remove keys from the environment or `models.json`. Command-backed keys (`!command`) cannot be
entered here; configure them through Pi. Adding another single-key provider requires a catalog
entry in `shared/providerApiKeys.ts` and a bundled logo, not another settings flow. Rows follow
the catalog's order, which is kept alphabetical.

## Developer navigation

- **Owners:** `server/ProviderLogin.ts` and `server/SignInAttempts.ts`, `shared/providerApiKeys.ts`,
  `web/src/lib/signInAttempt.ts` and `web/src/components/ProviderLoginDialog.tsx`.
- **Smallest check:** `node --test --import ./test/setup.ts test/ProviderLogin.test.ts` (or
  `test/SignInAttempts.test.ts`); then the
  [Settings recipe](../.agents/skills/verify-piano/features/settings-other.md) on scratch Piano.
- **Not proved:** scratch Piano is signed out, so neither check shows a real provider accepting an
  OAuth sign-in or an API key.
