// vite.config.ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = mode === "development" ? (env.VITE_GEMINI_API_KEY || "") : "";

  return {
    plugins: [tailwindcss(), react()],
    envPrefix: "VITE_",
    define: {
      "process.env.API_KEY": JSON.stringify(apiKey),
      "process.env.GEMINI_API_KEY": JSON.stringify(apiKey),
      "process.env.NODE_ENV": JSON.stringify(mode),
    },
    server: {
      port: 3000,
      strictPort: true,
      host: true,
    },
    preview: {
      port: 3000,
      strictPort: true,
      host: true,
    },
    esbuild: mode === "production" ? { drop: ["console", "debugger"] } : undefined,
  };
});
