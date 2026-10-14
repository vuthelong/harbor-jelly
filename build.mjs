import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const src = f => readFileSync(join(root, 'src', f), 'utf8');
const guard = (code, name) => {
  if (/<\/script/i.test(code)) throw new Error(`${name} contains a closing script tag`);
  return code;
};

let html = src('index.html');
html = html.replace('<!--@style-->', () => `<style>\n${src('style.css')}</style>`);
html = html.replace('<!--@core-->', () => `<script id="harbor-core">\n${guard(src('core.js'), 'core.js')}</script>`);
const scripts = ['geometry.js', 'sim.js', 'shaders.js', 'life.js', 'app.js']
  .map(f => `<script id="harbor-${f.replace('.js', '')}">\n${guard(src(f), f)}</script>`)
  .join('\n');
html = html.replace('<!--@scripts-->', () => scripts);
writeFileSync(join(root, 'harbor-jelly.html'), html);
console.log(`harbor-jelly.html written (${(html.length / 1024).toFixed(1)} KB)`);
