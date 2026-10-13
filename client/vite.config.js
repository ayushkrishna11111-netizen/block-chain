import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";

// The backend port lives in the project-root .env; a stray PORT in the shell
// environment must not point the proxy at a random port.
const { parsed } = dotenv.config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
});

function apiPort() {
  for (const candidate of [parsed?.PORT, process.env.PORT]) {
    const value = Number.parseInt(candidate ?? "", 10);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return 5000;
}

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 is in use on this machine by the previous instance.
    port: 5174,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort()}`,
        changeOrigin: true,
      },
    },
  },
});
