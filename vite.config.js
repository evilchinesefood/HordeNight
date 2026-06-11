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
    rollupOptions: { input: "Index.html" },
  },
});
