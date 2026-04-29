// index.js
const { App } = require("@slack/bolt");
const schedule = require("node-schedule");
const { DateTime } = require("luxon");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true, // easier for local dev; use HTTP for production
  appToken: process.env.SLACK_APP_TOKEN,
});

// In-memory store (replace with a real DB like Redis/Postgres for production)
const tasks = new Map();

// Parse: @bombie @alice @bob 2025-05-10 14:00 Fix the login bug
app.event("app_mention", async ({ event, client, say }) => {
  const text = event.text;

  // Extract mentioned users (skip the first one, which is @bombie itself)
  const userMentions = [...text.matchAll(/<@([A-Z0-9]+)>/g)]
    .map((m) => m[1])
    .filter((id) => id !== event.authorizations?.[0]?.user_id);

  // Extract deadline — supports formats like "2025-05-10 14:00" or "May 10 2pm"
  const deadlineMatch = text.match(
    /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/
  );
  if (!deadlineMatch || userMentions.length === 0) {
    await say(
      "Usage: `@bombie @person1 @person2 YYYY-MM-DD HH:MM task description`"
    );
    return;
  }

  const deadline = DateTime.fromFormat(deadlineMatch[1], "yyyy-MM-dd HH:mm", {
    zone: "Asia/Singapore", // change to your timezone
  });

  // Extract task description (everything after the deadline)
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
    deadline: deadline.toJSDate(),
    description: taskDescription,
  });

  // Confirm the task was registered
  const assigneeList = userMentions.map((id) => `<@${id}>`).join(", ");
  await say(
    `:white_check_mark: Task registered!\n*Task:* ${taskDescription}\n*Assigned to:* ${assigneeList}\n*Deadline:* ${deadline.toFormat("MMM dd, yyyy HH:mm")}\n\nReact with ✅ to mark as done before the deadline.`
  );

  // Schedule the deadline check
  schedule.scheduleJob(deadline.toJSDate(), async () => {
    await checkDeadline(taskId, client);
  });
});

async function checkDeadline(taskId, client) {
  const task = tasks.get(taskId);
  if (!task) return;

  // Fetch reactions on the original message
  const reactionsResponse = await client.reactions.get({
    channel: task.channel,
    timestamp: task.messageTs,
    full: true,
  });

  const checkmarkReaction = reactionsResponse.message.reactions?.find(
    (r) => r.name === "white_check_mark"
  );
  const reactedUsers = new Set(checkmarkReaction?.users || []);

  // Find assignees who haven't reacted
  const missing = task.assignees.filter((id) => !reactedUsers.has(id));

  if (missing.length === 0) {
    // Everyone checked in — optionally post a success message
    return;
  }

  // Build the reminder message
  const missingList = missing.map((id) => `<@${id}>`).join(", ");
  await client.chat.postMessage({
    channel: task.channel,
    text:
      `:rotating_light: *Deadline reached!*\n` +
      `<@${task.assigner}> assigned: *${task.description}*\n\n` +
      `The following people haven't confirmed completion yet: ${missingList}\n` +
      `Please react with ✅ on the original message or provide an update!`,
  });

  tasks.delete(taskId);
}

(async () => {
  await app.start();
  console.log("⚡️ Bombie bot is running!");
})();
