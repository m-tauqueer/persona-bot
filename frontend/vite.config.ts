import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, "..", "");
  const frontendOrigin = env.FRONTEND_ORIGIN;
  const gatewayPort = env.GATEWAY_PORT;
  if (!frontendOrigin) {
    throw new Error("FRONTEND_ORIGIN is not set");
  }
  if (!gatewayPort) {
    throw new Error("GATEWAY_PORT is not set");
  }
  const frontend = new URL(frontendOrigin);
  const listenPort = Number(frontend.port);
  const gateway = `http://127.0.0.1:${gatewayPort}`;
  const proxy = {
    target: gateway,
    changeOrigin: true,
  } as const;

  if (command === "serve") {
    if (!Number.isInteger(listenPort) || listenPort <= 0) {
      throw new Error("FRONTEND_ORIGIN must include a port");
    }
  }

  return {
    plugins: [react()],
    envDir: "..",
    server:
      command === "serve"
        ? {
            host: true,
            port: listenPort,
            strictPort: true,
            proxy: {
              "/auth": proxy,
              "/api": proxy,
              "/health": proxy,
              "/ws": { ...proxy, ws: true },
            },
          }
        : undefined,
  };
});
