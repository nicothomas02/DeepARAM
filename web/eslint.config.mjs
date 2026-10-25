import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    // Rules new in the React Compiler era of eslint-plugin-react-hooks; the existing effects were written before them.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
    },
  },
  {
    ignores: ["node_modules/**", ".next/**", ".open-next/**", "public/**", ".wrangler/**", "cloudflare-env.d.ts", "out/**", "build/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
