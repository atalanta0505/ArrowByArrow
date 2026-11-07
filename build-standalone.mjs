/**
 * Bundles the entire 《一箭又一箭 · 纯净定制版》 application into a single,
 * zero-dependency standalone HTML file (`一箭又一箭_手机离线单文件版.html`)
 * that can be sent to a phone via WeChat/USB and opened 100% offline!
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function stripImportsAndExports(code) {
  return code
    .replace(/^\s*import\s+[\s\S]*?from\s+['"].*?['"];?\s*$/gm, '')
    .replace(/^\s*export\s+default\s+/gm, '')
    .replace(/^\s*export\s+(?=(?:async\s+)?function|class|const|let|var)/gm, '');
}

const htmlRaw = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const cssRaw = fs.readFileSync(path.join(__dirname, 'src/ui/styles.css'), 'utf8');

const moduleOrder = [
  'src/engine/patterns.js',
  'src/engine/solver.js',
  'src/engine/generator.js',
  'src/audio/soundAndHaptics.js',
  'src/renderer/canvasView.js',
  'src/ui/app.js',
];

const combinedJS = moduleOrder
  .map(rel => {
    const content = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    return `// === [${rel}] ===\n` + stripImportsAndExports(content);
  })
  .join('\n\n');

let standaloneHTML = htmlRaw
  .replace('<link rel="manifest" href="./manifest.json" />', '')
  .replace(
    '<link rel="stylesheet" href="./src/ui/styles.css" />',
    `<style>\n${cssRaw}\n</style>`
  )
  .replace(
    /<script type="module" src="\.\/src\/ui\/app\.js"><\/script>[\s\S]*?<\/body>/,
    `<script>\n(function() {\n${combinedJS}\n})();\n</script>\n</body>`
  );

const outPath = path.join(__dirname, '一箭又一箭_手机离线单文件版.html');
fs.writeFileSync(outPath, standaloneHTML, 'utf8');
console.log(`✅ 已生成手机无网离线单文件版: ${outPath} (${(standaloneHTML.length / 1024).toFixed(1)} KB)`);
