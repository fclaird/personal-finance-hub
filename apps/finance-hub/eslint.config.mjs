import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Existing pages hydrate persisted UI from localStorage in effects; warn only so CI can gate new issues.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/optionChain/**", "src/lib/strategyLab/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/optionChain/internal",
                "@/lib/optionChain/internal/*",
                "@/lib/strategyLab/internal",
                "@/lib/strategyLab/internal/*",
              ],
              message: "Use the public option chain and strategy lab modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/strategyLab/lab",
              importNames: ["createLab", "editLab", "evaluateLab"],
              allowTypeImports: true,
              message: "Pages and components go through useStrategyLab.",
            },
          ],
          patterns: [
            {
              group: [
                "@/lib/optionChain/internal",
                "@/lib/optionChain/internal/*",
                "@/lib/strategyLab/internal",
                "@/lib/strategyLab/internal/*",
              ],
              message: "Use the public option chain and strategy lab modules.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "desktop/**",
  ]),
]);

export default eslintConfig;
