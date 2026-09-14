import path from "node:path";

import { config } from "dotenv";

const rootDirectory = path.resolve(import.meta.dirname, "../../../..");
const lifecycleEvent = process.env.npm_lifecycle_event;
const explicitNodeEnv = process.env.NODE_ENV;
const requestedMode =
  explicitNodeEnv ??
  (lifecycleEvent === "start" ? "production" : lifecycleEvent === "test" ? "test" : "development");
const mode =
  requestedMode === "production" || requestedMode === "test" ? requestedMode : "development";

// Load the selected profile first so it wins over shared values in .env.
// Values provided by the host process still take precedence because dotenv's
// default behavior does not overwrite existing process.env entries.
config({ path: path.join(rootDirectory, `.env.${mode}`) });
config({ path: path.join(rootDirectory, ".env") });

if (explicitNodeEnv === undefined) {
  process.env.NODE_ENV = mode;
}
