import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { resolve } from "node:path";

/**
 * electron-vite already knows where main, preload and renderer live if the
 * conventional layout is used, so only the parts that differ are stated.
 */
export default defineConfig({
    main: {
        // serialport is a native module and has to stay a real require.
        // esptool-js is the opposite: it ships browser-style modules with JSON
        // imports that Node cannot load unbundled, so it is bundled into main.
        plugins: [externalizeDepsPlugin({ exclude: ["esptool-js"] })],
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
    },
    renderer: {
        root: resolve(__dirname, "src/renderer"),
        plugins: [
            react(),
            // Imported with `?react`, an SVG becomes a component whose markup is
            // in the DOM - the only way `currentColor` can work. As an <img> it
            // would be an opaque image and could not take the theme's colour.
            svgr(),
        ],
    },
});
