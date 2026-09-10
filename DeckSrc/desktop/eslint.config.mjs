import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
    {
        ignores: ["dist/**", "out/**", "output/**", "node_modules/**"],
    },

    js.configs.recommended,
    ...tseslint.configs.recommended,

    {
        // Formatting is Prettier's job alone. Turning the stylistic rules off
        // here stops the two tools disagreeing and fighting over the same lines.
        ...prettierConfig,
        plugins: { prettier },
        rules: {
            "prettier/prettier": "error",

            // An unused argument is often a signature the platform requires -
            // Electron's IPC handlers all take an event they may not need - so
            // allow a leading underscore to say "deliberately unused".
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],

            // The renderer talks to hardware through a bridge that returns
            // plain data; silent `any` there would hide protocol mistakes.
            "@typescript-eslint/no-explicit-any": "error",

            eqeqeq: ["error", "always", { null: "ignore" }],
            "no-console": ["warn", { allow: ["warn", "error"] }],
        },
    },

    {
        files: ["src/renderer/**/*.{ts,tsx}"],
        plugins: { react, "react-hooks": reactHooks },
        languageOptions: {
            parserOptions: { ecmaFeatures: { jsx: true } },
        },
        settings: { react: { version: "detect" } },
        rules: {
            ...react.configs.recommended.rules,
            ...reactHooks.configs.recommended.rules,

            // The JSX transform makes the import unnecessary.
            "react/react-in-jsx-scope": "off",
            "react/prop-types": "off",
        },
    },

    {
        files: ["src/main/**/*.ts", "src/preload/**/*.ts"],
        rules: {
            // These two run in Node, where logging to the terminal is the only
            // way to say anything.
            "no-console": "off",
        },
    },
);
