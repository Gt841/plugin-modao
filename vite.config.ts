import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import zipPack from 'vite-plugin-zip-pack';

export default defineConfig({
  plugins: [
    svelte(),
    viteStaticCopy({ targets: ['plugin.json', 'LICENSE', 'README.txt', 'icon.png'].map(src => ({src, dest:'.'})) }),
    zipPack({ inDir:'dist', outDir:'.', outFileName:'package.zip' }),
  ],
  build: {
    outDir:'dist', emptyOutDir:true, sourcemap:false,
    lib: {entry:resolve(__dirname, 'src/index.ts'), formats:['cjs'], fileName:() => 'index.js'},
    rollupOptions: {
      external:['siyuan'],
      output:{ assetFileNames:asset => asset.name === 'style.css' ? 'index.css' : '[name][extname]' },
    },
  },
});
