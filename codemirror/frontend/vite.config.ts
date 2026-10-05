import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const mdiRoot = dirname(createRequire(import.meta.url).resolve('@mdi/svg/package.json'));
const mdiModule = '\0virtual:mdi-icons';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'mdi-icon-catalog',
    resolveId(id) { if (id === 'virtual:mdi-icons') return mdiModule; },
    load(id) {
      if (id !== mdiModule) return;
      const metadata = JSON.parse(readFileSync(join(mdiRoot, 'meta.json'), 'utf8'));
      const icons: Record<string, string> = {};
      for (const { name } of metadata) {
        if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid MDI icon name');
        const svg = readFileSync(join(mdiRoot, 'svg', name + '.svg'), 'utf8');
        const path = svg.match(/<path\s+d="([^"]+)"/);
        if (!path) throw new Error('Missing MDI path: ' + name);
        icons[name] = path[1];
      }
      return 'export default ' + JSON.stringify(icons);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'MDI-LICENSE.txt', source: readFileSync(join(mdiRoot, 'LICENSE')) });
    },
  }],
  build: {
    outDir: '../static',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/codemirror/')) {
            return 'codemirror';
          }
          if (id.includes('node_modules/yaml')) {
            return 'yaml';
          }
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8099',
        changeOrigin: true,
      },
    },
  },
});
