# Skills and prompts

Use a **prompt** for a message you send often, such as a request to draft release notes. Use a **skill** for instructions Pi can apply across tasks, such as your team’s review process. Items you save in Piano are available to sessions you start afterwards, across projects.

## Create and use a prompt

1. Open **Settings → Prompts** and choose **New prompt**.
2. Enter a **Name**, **Description**, and **Instructions**. For example, name it `release-note` and enter `Write a release note for $@. Explain what changed for the user.` The placeholder `$@` includes all the arguments you type after the command.
3. Choose **Create prompt**. In a new session, enter `/release-note the new file preview` and send it.

## Create and use a skill

Open **Settings → Skills → New skill**. Give the skill a name such as `review-changes`, describe when to use it, and enter the steps you want Pi to follow. Choose **Create skill**.

In a new session, enter `/skill:review-changes` to use it. If you want to choose every time the skill runs, turn on **Disable model invocation** when creating it.

## Review a change from a session

You can ask Pi to “update my Piano release-note prompt to include a migration note.” Read the proposed changes in the conversation, then choose **Save prompt** or **Cancel**. For a new item, the button says **Create prompt** or **Create skill**.

To view or copy the full text later, select its name in Settings. To remove it from future sessions, open the item’s menu and choose **Delete**.
