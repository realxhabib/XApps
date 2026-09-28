import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sdk = fileURLToPath(new URL("../../packages/sdk/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@xapps\/sdk$/, replacement: `${sdk}/index.ts` },
      { find: /^@xapps\/sdk\/(.*)$/, replacement: `${sdk}/$1` },
      { find: /^@\/(.*)$/, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/$1` },
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
