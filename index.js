const { App } = require("@slack/bolt");
const schedule = require("node-schedule");
const { DateTime } = require("luxon");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const tasks = new Map();

app.event("app_mention", async ({ event, client }) => {
  const text = event.text;

  const userMentions = [...text.matchAll(/<@([A-Z0-9]+)>/g)]
    .map((m) => m[1])
    .slice(1);

  // Match either full date (2026-05-01 14:00) or short date (05-01 14:00)
  const fullDateMatch = text.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
  const shortDateMatch = text.match(/(\d{2}-\d{2}\s+\d{2}:\d{2})/);
  const deadlineMatch = fullDateMatch || shortDateMatch;

  if (!deadlineMatch || userMentions.length === 0) {
    await client.chat.postMessage({
      channel: event.channel,
      text: "Usage: `@bombie @person1 @person2 MM-DD HH:MM task description`",
    });
    return;
  }

  const dateString = fullDateMatch
    ? deadlineMatch[1]
    : `2026-${deadlineMatch[1]}`;

  const deadline = DateTime.fromFormat(dateString, "yyyy-MM-dd HH:mm", {
    zone: "Asia/Singapore",
  });

  const taskDescription = text
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(deadlineMatch[0], "")
    .trim();

  const assigneeList = userMentions.map((id) => `<@${id}>`).join(", ");

  const confirmMsg = await client.chat.postMessage({
    channel: event.channel,
    text:
      `:white_check_mark: Task registered!\n` +
      `*Task:* ${taskDescription}\n` +
      `*Assigned to:* ${assigneeList}\n` +
      `*Deadline:* ${deadline.toFormat("MMM dd, yyyy HH:mm")}\n\n` +
      `React with ✅ *on this message* to mark as done before the deadline.`,
  });

  const taskId = `${event.channel}-${confirmMsg.ts}`;
  tasks.set(taskId, {
    channel: event.channel,
    messageTs: confirmMsg.ts,
    assigner: event.user,
    assignees: userMentions,
    description: taskDescription,
  });

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
        `:fire: React with ✅ on the task registered message or provide an update before things get worse!`,
    });

    tasks.delete(taskId);
  });
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("⚡️ Bombie bot is running!");
})();
