import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('dist', { recursive: true });
await copyFile('index.html', 'dist/index.html');
await copyFile('src/style.css', 'dist/style.css');
await copyFile('src/theme.css', 'dist/theme.css');
await mkdir('dist/fonts', { recursive: true });
await copyFile('node_modules/vazir-font/dist/Vazir-Variable.woff2', 'dist/fonts/Vazir-Variable.woff2');
await copyFile('node_modules/vazir-font/OFL.txt', 'dist/fonts/OFL.txt');

const options = {
  entryPoints: [resolve('src/main.jsx')],
  outfile: resolve('dist/app.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  jsx: 'automatic',
  target: ['chrome100', 'edge100'],
};

if (process.argv.includes('--watch')) {
  const { context } = await import('esbuild');
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching source files. Open dist/index.html in Chrome or Edge.');
} else {
  await build(options);
  console.log('Built dist/index.html');
}
