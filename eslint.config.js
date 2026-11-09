/**
 * 检查源码中的未定义引用、遗留变量和模块边界，组件用法由 JSX 规则识别。
 * 排版交给 Prettier；共享规则不得依赖 Node.js、Electron 或界面模块，保证两端可以复用。
 */
import globals from "globals"
import react from "eslint-plugin-react"

export default [
  { ignores: ["node_modules/**", "README.assets/**", "src/assets/**"] },
  {
    files: ["**/*.{js,jsx,cjs}"],
    plugins: { react },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-undef": "error",
      curly: ["error", "all"],
      "prefer-const": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-unused-private-class-members": "error",
      "react/jsx-uses-react": "error",
      "react/jsx-uses-vars": "error",
      "react/jsx-no-undef": "error",
    },
  },
  {
    files: ["shared/**/*.js"],
    ignores: ["**/*.test.js"],
    rules: { "no-restricted-imports": ["error", { patterns: ["node:*", "electron", "@/*"] }] },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    ignores: ["**/*.test.js"],
    rules: { "no-restricted-imports": ["error", { patterns: ["node:*", "electron", "**/electron/**"] }] },
  },
]
