# Publish a document to Radius

Use a Radius artifact when you want a report, page, or other document with a link you can open later. To send the saved conversation itself, use [Share a saved session](../sharing/README.md).

1. Sign in under **Settings → Providers → Radius** and start a new session. [Set up Radius](README.md)
2. Tell Pi what to publish. For example, “Publish the release notes in `notes/release.md` as a private Radius artifact and give me the link.” Paths can be relative to the session’s folder.
3. Open the confirmed link in Pi’s reply. You can also open **Artifacts** in the session header and choose the document by title.

New artifacts are private. To revise a document, tell Pi which artifact to update and what to change. For example, “Update the release notes at that link with the new rollout date.” An update keeps the same link and visibility. Earlier revisions remain available. If someone else has updated the document, ask Pi to read the latest revision before applying your changes.

## File size

For a long document, ask Pi to publish it directly from a file. Supported formats include Markdown, HTML, Mermaid, CSV, NDJSON, and asciicast. Use a non-empty UTF-8 text file up to **25 MiB**. Review its contents first. The complete text, including any secrets in it, will be sent to Radius. To keep a document on your machine, ask Pi to save a local file.

## Confirmation and uncertainty

If Pi cannot confirm publication, check your **Artifacts** in Radius before asking it to publish again. An interrupted request may already have created the document. If the publication tools are unavailable, sign in to Radius and start a new session.

## Use without Piano

Piano sessions already include the artifact tools. For standalone Pi, sign in to Radius in Pi and open a Piano checkout with its dependencies installed. To try the tools for one session, run this command from the checkout.

```sh
pi --extension ./features/radius/extension/index.ts
```

To keep the tools available for future Pi sessions, install the package from that checkout.

```sh
pi install /absolute/path/to/piano/features/radius
```

Keep the checkout at that path while the package is installed.
