import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  publicDir: "public",
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("vite/preload-helper")) return "vendor-react";
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("@applemusic-like-lyrics") ||
            id.includes("gl-matrix") ||
            id.includes("pixi") ||
            id.includes("earcut") ||
            id.includes("figma-squircle") ||
            id.includes("corner-smoothing")
          )
            return "vendor-amll";
          if (id.includes("lucide-react")) return "vendor-icons";
          // 媒体/文件处理：jszip(+pako 压缩)、music-metadata(+file-type)、截图、ID3 写入
          if (
            id.includes("music-metadata") ||
            id.includes("jszip") ||
            id.includes("pako") ||
            id.includes("file-type") ||
            id.includes("modern-screenshot") ||
            id.includes("browser-id3-writer")
          )
            return "vendor-media";
          if (
            id.includes("framer-motion") ||
            id.includes("motion-dom") ||
            id.includes("motion-utils")
          )
            return "vendor-motion";
          // react 本体 + 首屏必需生态（jotai/@remix-run/router 与 react 同 chunk，
          // 消除 vendor-react ↔ vendor-misc 循环依赖）
          if (id.includes("react") || id.includes("scheduler") || id.includes("jotai") || id.includes("router"))
            return "vendor-react";
          // markdown 渲染 + 二维码：marked、qrcode 及其依赖（pngjs/url 等）
          if (
            id.includes("marked") ||
            id.includes("qrcode") ||
            id.includes("pngjs") ||
            id.includes("dijkstrajs") ||
            id.includes("yargs") ||
            id.includes("/url/")
          )
            return "vendor-markdown";
          return "vendor-misc";
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/ws": { target: "http://localhost:8080", ws: true },
    },
  },
});
