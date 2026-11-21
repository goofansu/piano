# Send session events to a webhook

Use a webhook to notify another service when Pi finishes a response, needs your input, or encounters a failure. You’ll need a receiver that accepts HTTPS POST requests at a public address. Localhost, private network addresses, and URLs containing credentials or a fragment are refused.

## Create and test a webhook

1. Open **Settings → Webhooks** and choose **New webhook**.
2. Enter the receiver’s **URL** and, if required, its **Bearer token**. Select the events you want. **session.completed** is selected initially.
3. To test before sending session events, turn **Active** off and choose **Create webhook**. Open the new row’s menu and choose **Test**. This sends a real `ping` to your receiver even while the webhook is off.
4. Check the delivery status on the row. After a successful test, turn **Active** on.

## Choose events

| Event | When it’s sent | What the receiver can see |
| --- | --- | --- |
| `session.completed` | Pi finishes a response. | The latest answer, shortened if needed. |
| `session.needs_input` | Pi needs you to answer a question. | The question and any choices. |
| `session.failed` | A model turn fails after retries, or the Pi process closes unexpectedly. | Failure details and, where available, the latest answer. Stopping work yourself does not send this event. |

Event deliveries can also include the session title and link, model, folder name, and linked pull request. Choose a receiver where those details and the response text can be shared.

If your receiver handles failures differently, check `failure.reason`. A value of `turn_failed` means the model turn failed after any retries. For a process exit, `exited` includes an exit code when one is available.

Use the **Active** switch to pause session notifications. The row shows the latest delivery outcome. If delivery fails, check the receiver address, token, and HTTP status. Use **Edit** to change the destination or **Delete** to remove it and its saved token.
