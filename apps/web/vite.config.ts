import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const envDirectory = "../..";
  const env = loadEnv(mode, envDirectory, "");
  const proxyTarget = env.DEV_PROXY_TARGET || "http://localhost:3000";

  return {
    envDir: envDirectory,
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: proxyTarget,
          ws: true,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
