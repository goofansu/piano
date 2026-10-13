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
**Settings → Providers** and click **Sign in**. To stop it, click **Cancel sign-in**. An attempt
expires after 15 minutes or when Piano stops.

## Limits

Start a new session after you sign in. A running session keeps the model list it started with.

This flow uses the providers built into the bundled Pi SDK and your `models.json`. For OAuth
providers that only an extension adds, API-key setup, and logout, use the Pi TUI. A custom
`PIANO_PI_CLI` must use the same credential format.
