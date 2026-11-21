# Connect Pi to an MCP server

Use **Settings → MCP** to give Pi tools from an external service or a local program. For example, connecting Linear lets you ask Pi about your issues. The service decides what your account can access.

## Connect Linear or Jira

1. Under **Available**, choose **Connect** beside **Linear** or **Jira**.
2. Complete the sign-in prompt if it appears. The server appears under **Connected** and shows **Ready** when setup is complete.
3. Start a new session to use its tools. If the server later offers **Reconnect**, choose it and complete sign-in again.

## Add a custom server

Choose **Add MCP server**, enter a **Name**, and choose the type your server uses.

| Type | What to enter |
| --- | --- |
| **URL** | Enter the endpoint from the service’s setup instructions. Supply an **Authorization header** or additional **Headers** if the service requires them. |
| **Command** | Enter the executable and put each argument on its own line. Add any environment variables the program needs. Leave **Working directory** empty to run it in each session’s folder. Adding or saving the server runs the command once on the Piano machine, so review it first. |

If the service gives you an `mcpServers` configuration, choose the **JSON** tab and paste one server entry at a time. Choose **Add MCP server** to finish, then start a new session.

To change a custom server, open its row menu and choose **Edit**. To remove it, choose **Disconnect** for a URL server or **Delete** for a command server. Disconnecting also removes that server’s saved sign-in from Pi on this machine.
