import { createApp } from "./app.js";

const app = await createApp();
const port = Number(process.env.ORCHESTRATOR_PORT ?? "43117");
await app.listen({ host: "0.0.0.0", port });
