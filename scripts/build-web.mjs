import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist/web', { recursive: true });
await build({ entryPoints: ['src/web/app.ts'], outfile: 'dist/web/app.js', bundle: true, minify: true, target: 'es2022', sourcemap: true });
await Promise.all(['index.html', 'styles.css'].map(file => copyFile(`src/web/${file}`, `dist/web/${file}`)));
