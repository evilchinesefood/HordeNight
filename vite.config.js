import { defineConfig } from "vite";

const PascalIndex = () => ({
  name: "pascal-index",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === "/" || req.url === "/index.html") req.url = "/Index.html";
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === "/" || req.url === "/index.html") req.url = "/Index.html";
      next();
    });
  },
});

export default defineConfig({
  base: "./",
  plugins: [PascalIndex()],
  build: {
    rollupOptions: { input: "Index.html" },
  },
});
