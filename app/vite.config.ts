import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": "http://localhost:4317" } },
  build: {
    rolldownOptions: {
      output: {
        // libraries in their own files: smaller chunks, cached across updates
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: "flow",
              test: /node_modules[\\/](@xyflow|@dagrejs|d3-[\w-]+)[\\/]/,
            },
            { name: "vendor", test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
});
