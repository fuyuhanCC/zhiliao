import { z } from "zod";

const runtimeConfigSchema = z.object({
  apiBaseUrl: z.string().min(1),
  socketPath: z.string().min(1),
});

export const runtimeConfig = runtimeConfigSchema.parse({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "/api/v1",
  socketPath: import.meta.env.VITE_SOCKET_PATH ?? "/socket.io",
});
