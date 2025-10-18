import react from '@vitejs/plugin-react-swc';
import path from 'path'; // ✅ Required for the alias to work
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'), // ✅ Add this line to enable @ alias
      // Ensure imports of `mqtt` resolve to the browser-compatible bundle.
      // This avoids runtime default-export mismatch when Vite optimizes dependencies.
      'mqtt': 'mqtt/dist/mqtt'
    },
  },
  optimizeDeps: {
    include: ['@emotion/react', '@emotion/styled'],
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      overlay: false,
    },
  },
});
