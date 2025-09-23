// dump-project.js ===(RUN)===> node dump-project.js 
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'project_dump.txt');
const EXCLUDE_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', '.txt', '.ttf', 'package-lock.json', 'README.md', 'dump-project.js', 'project_dump.txt', 'animation'];
const EXT_WHITELIST = ['.js','.jsx','.ts','.tsx','.json','.md','.css','.scss','.html','.py','.java','.env','.yml','.yaml', '.example'];

function isExcluded(p) {
  return EXCLUDE_DIRS.some(d => p.split(path.sep).includes(d));
}

function walk(dir) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (isExcluded(full)) continue;
    if (it.isDirectory()) files = files.concat(walk(full));
    else if (it.isFile()) {
      const ext = path.extname(it.name).toLowerCase();
      if (EXT_WHITELIST.includes(ext)) files.push(full);
    }
  }
  return files;
}

const files = walk(ROOT).sort();
fs.writeFileSync(OUT, '', 'utf8');

for (const f of files) {
  fs.appendFileSync(OUT, `\n\n=== FILE: ${f} ===\n`, 'utf8');
  try {
    const content = fs.readFileSync(f, 'utf8');
    fs.appendFileSync(OUT, content, 'utf8');
  } catch (err) {
    fs.appendFileSync(OUT, `\n<<ERROR READING FILE: ${err.message}>>\n`, 'utf8');
  }
}

console.log('Done. Output ->', OUT);
