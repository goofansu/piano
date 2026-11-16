import stylelint from "stylelint";
import { allowedComment, authoredCommentFile, commentPolicyMessage } from "./comment-policy.mjs";

const ruleName = "piano/comment-policy";
const messages = stylelint.utils.ruleMessages(ruleName, { comment: commentPolicyMessage });
const rule = (enabled) => (root, result) => {
  if (!stylelint.utils.validateOptions(result, ruleName, { actual: enabled, possible: [true] }))
    return;
  if (!authoredCommentFile(root.source?.input.file ?? "")) return;
  root.walkComments((node) => {
    if (!allowedComment(node.text, "Block", "css"))
      stylelint.utils.report({
        message: messages.comment,
        node,
        result,
        ruleName,
        index: 0,
        endIndex: node.toString().length,
      });
  });
};
rule.ruleName = ruleName;
rule.messages = messages;

export default stylelint.createPlugin(ruleName, rule);
