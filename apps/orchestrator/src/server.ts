import { createApp } from "./app.js";

const app = await createApp();
const port = Number(process.env.ORCHESTRATOR_PORT ?? "43117");

try {
  await app.listen({ host: "0.0.0.0", port });
  console.log(`SKH agent orchestrator listening on http://127.0.0.1:${port}`);
} catch (error) {
  console.error(`Failed to start SKH agent orchestrator on port ${port}.`);
  console.error(error);
  process.exit(1);
}
