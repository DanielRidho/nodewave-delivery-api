import { app } from "./app";
import { env } from "./config";

console.log(`NodeWave Delivery API listening on http://localhost:${env.PORT}`);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
