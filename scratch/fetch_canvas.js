require('dotenv').config();
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN
});

(async () => {
  try {
    const fileId = 'F0BK0GP80C8';
    console.log(`Fetching info for canvas: ${fileId}`);
    const fileInfo = await app.client.files.info({
      file: fileId
    });
    console.log(JSON.stringify(fileInfo.file, null, 2));
  } catch (error) {
    console.error("Error fetching canvas info:", error);
  }
})();
