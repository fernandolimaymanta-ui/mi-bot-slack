require('dotenv').config();
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN
});

(async () => {
  try {
    const canvasId = process.env.CANVAS_ID;
    console.log(`Test writing to Canvas: ${canvasId}`);
    
    await app.client.apiCall('canvases.edit', {
      canvas_id: canvasId,
      changes: [
        {
          operation: "insert_at_end",
          document_content: {
            type: "markdown",
            markdown: "Prueba de escritura desde script temporal."
          }
        }
      ]
    });
    console.log("Success!");
  } catch (error) {
    console.error("Error writing to canvas:", error.data ? error.data : error);
  }
})();
