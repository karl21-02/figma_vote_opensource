import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const isWatch = process.argv.includes('--watch');

// Build plugin code (sandbox)
const codeConfig = {
  entryPoints: [path.join(rootDir, 'src/code.ts')],
  bundle: true,
  outfile: path.join(rootDir, 'dist/code.js'),
  target: 'es2015',
  format: 'iife',
};

// Build UI script
const uiScriptConfig = {
  entryPoints: [path.join(rootDir, 'src/ui/main.ts')],
  bundle: true,
  write: false,
  target: 'es2015',
  format: 'iife',
};

async function buildUI() {
  const result = await esbuild.build(uiScriptConfig);
  const jsCode = result.outputFiles[0].text;

  const htmlTemplate = fs.readFileSync(
    path.join(rootDir, 'src/ui/index.html'),
    'utf-8'
  );
  const cssContent = fs.readFileSync(
    path.join(rootDir, 'src/ui/styles.css'),
    'utf-8'
  );

  const finalHtml = htmlTemplate
    .replace('/* __STYLES__ */', cssContent)
    .replace('/* __SCRIPT__ */', jsCode);

  fs.writeFileSync(path.join(rootDir, 'dist/ui.html'), finalHtml);
  console.log('  dist/ui.html');
}

async function build() {
  console.log('Building...');
  await esbuild.build(codeConfig);
  console.log('  dist/code.js');
  await buildUI();
  console.log('Build complete.');
}

if (isWatch) {
  // Watch mode: rebuild on file changes
  const ctx = await esbuild.context(codeConfig);
  await ctx.watch();
  console.log('Watching for changes...');

  const chokidar = await import('chokidar').catch(() => null);
  if (chokidar) {
    chokidar
      .watch([path.join(rootDir, 'src/ui/')], { ignoreInitial: true })
      .on('all', async () => {
        try {
          await buildUI();
        } catch (e) {
          console.error('UI build error:', e.message);
        }
      });
  } else {
    console.log('Install chokidar for UI watch mode: npm i -D chokidar');
  }

  await build();
} else {
  await build();
}
