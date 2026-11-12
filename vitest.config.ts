import { defineConfig } from "vitest/config";

// Pruebas unitarias (0 LLM, 0 red). Configuración propia para no cargar los
// plugins de Vite del frontend (Tailwind, React) en las pruebas.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    unstubEnvs: true,
  },
});
