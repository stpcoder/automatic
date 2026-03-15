import { createApp } from "./app.js";

const app = await createApp();
await app.listen({ host: "0.0.0.0", port: 3000 });
