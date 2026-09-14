import { z } from "zod";

import { SOCKET_IO_PATH } from "@zhiliao/shared";

const runtimeConfigSchema = z.object({
  apiBaseUrl: z.string().min(1),
  socketPath: z.string().min(1),
  socketTransport: z.enum(["auto", "polling"]),
});

export const runtimeConfig = runtimeConfigSchema.parse({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "/api/v1",
  socketPath: import.meta.env.VITE_SOCKET_PATH ?? SOCKET_IO_PATH,
  socketTransport: import.meta.env.VITE_SOCKET_TRANSPORT ?? "polling",
});
