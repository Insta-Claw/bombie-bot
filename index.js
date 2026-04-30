const { App } = require("@slack/bolt");
const schedule = require("node-schedule");
const { DateTime } = require("luxon");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const tasks = new Map();

app.event("app_mention", async ({ event, client, say }) => {
  const text = event.text;

  const userMentions = [...text.matchAll(/<@([A-Z0-9]+)>/g)]
    .map((m) => m[1])
    .slice(1); // skip the first mention (the bot itself)

  const deadlineMatch = text.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
  if (!deadlineMatch || userMentions.length === 0) {
    await say("Usage: `@bombie @person1 @person2 YYYY-MM-DD HH:MM task description`");
    return;
  }

  const deadline = DateTime.fromFormat(deadlineMatch[1], "yyyy-MM-dd HH:mm", {
    zone: "Asia/Singapore",
  });

  const taskDescription = text
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(deadlineMatch[0], "")
    .trim();

  const taskId = `${event.channel}-${event.ts}`;
  tasks.set(taskId, {
    channel: event.channel,
    messageTs: event.ts,
    assigner: event.user,
    assignees: userMentions,
    description: taskDescription,
  });

  const assigneeList = userMentions.map((id) => `<@${id}>`).join(", ");
  await say(
    `:white_check_mark: Task registered!\n*Task:* ${taskDescription}\n*Assigned to:* ${assigneeList}\n*Deadline:* ${deadline.toFormat("MMM dd, yyyy HH:mm")}\n\nReact with ✅ on this message to mark as done before the deadline.`
  );

  schedule.scheduleJob(deadline.toJSDate(), async () => {
    const task = tasks.get(taskId);
    if (!task) return;

    const reactionsResponse = await client.reactions.get({
      channel: task.channel,
      timestamp: task.messageTs,
      full: true,
    });

    const checkmarkReaction = reactionsResponse.message.reactions?.find(
      (r) => r.name === "white_check_mark"
    );
    const reactedUsers = new Set(checkmarkReaction?.users || []);
    const missing = task.assignees.filter((id) => !reactedUsers.has(id));

    if (missing.length === 0) return;

    const missingList = missing.map((id) => `<@${id}>`).join(", ");
    await client.chat.postMessage({
      channel: task.channel,
      text:
        `:bomb: :boom: :bomb: *BOOM! The deadline exploded!* :bomb: :boom: :bomb:\n\n` +
        `<@${task.assigner}> assigned: *${task.description}*\n\n` +
        `The following people haven't defused the bomb with ✅ yet: ${missingList}\n\n` +
        `:fire: React with ✅ on the original message or provide an update before things get worse!`,
    });

    tasks.delete(taskId);
  });
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("⚡️ Bombie bot is running!");
})();
