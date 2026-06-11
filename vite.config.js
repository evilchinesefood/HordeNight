import { defineConfig } from "vite";

const PascalIndex = () => ({
  name: "pascal-index",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, query] = req.url.split("?");
      if (path === "/" || path === "/index.html")
        req.url = "/Index.html" + (query ? "?" + query : "");
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, query] = req.url.split("?");
      if (path === "/" || path === "/index.html")
        req.url = "/Index.html" + (query ? "?" + query : "");
      next();
    });
  },
});

export default defineConfig({
  base: "./",
  publicDir: "Public",
  plugins: [PascalIndex()],
  build: {
    rollupOptions: {
      input: "Index.html",
      output: {
        // vendor split: the app shell parses while ez-tree's inlined bark
        // JPEGs (the bulk of the old 4.6MB single chunk) still stream
        manualChunks: { three: ["three"], eztree: ["@dgreenheck/ez-tree"] },
      },
    },
  },
});
