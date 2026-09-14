import path from "node:path";

import { config } from "dotenv";

const rootEnvFile = path.resolve(import.meta.dirname, "../../../../.env");

config({ path: rootEnvFile });
