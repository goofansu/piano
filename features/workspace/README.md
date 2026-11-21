# Work with a checkout

## Choose a working directory

Before sending the first message in a new session, open **Directory** and select the checkout where Pi should work. To use a folder outside the list, select **Browse…**, open the folder, and choose **Use this directory**. If Piano shows **Untrusted**, switch to **Trusted** only if you want Pi to load that directory's local `.pi` resources.

## Review changes

In a session working in a Git checkout, open **Changes**. Choose **Uncommitted** to review local edits. To see how the checkout differs from its base branch, choose the branch name in the comparison menu when available.

Expand a file to read its diff. **Ask about this file** adds the displayed patch to your draft so you can add a question and send it to Pi. Choose **Refresh changes** to read the checkout again after more edits.

To connect a GitHub pull request, choose **Pull request** from the [command palette](../commands/README.md). Enter the PR URL and choose **Link**, or select **Find from branch**. Once linked, open **Changes** to see the PR and its available check and review statuses.

## Local file previews

Select a local file link in the conversation. On a wide screen you can also choose **Show session rail** and open a file under **Outputs**. The viewer reads the current file on disk. Select the link again after the file changes.

### Formats and limits

| File | Maximum preview size |
| --- | --- |
| UTF-8 text, code, Markdown, HTML, or SVG | 1 MiB |
| PNG, JPEG, GIF, or WebP image | 10 MiB |
| Supported audio or PDF | 20 MiB |
| MP4 or WebM video | 32 MiB |

Turn **Preview** off to read the source of Markdown or HTML. **Download file** saves the original file.

### Static HTML

HTML previews show the document with supported local images and styles. Page scripts are disabled, so interactive controls that depend on JavaScript won't work in the preview.

## Ownership and privacy

Piano can open supported files its server account can read, including files outside the checkout. Opening an outside file leaves it out of **Changes** and **Outputs**. Media, PDFs, and downloaded originals can contain private information. Check the file before sharing it.
