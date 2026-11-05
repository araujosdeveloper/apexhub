const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
for (const relative of ['server.js', ...['src', 'scripts', 'test-support', 'integration', 'test'].flatMap(dir => fs.readdirSync(path.join(root, dir),{recursive:true}).filter(n => n.endsWith('.js')).map(n => path.join(dir, n)))]) {
 execFileSync(process.execPath, ['--check', path.join(root, relative)], { stdio: 'inherit' });
}
for (const name of fs.readdirSync(path.join(root, '../frontend')).filter(n => n.endsWith('.html'))) {
 const html = fs.readFileSync(path.join(root, '../frontend', name), 'utf8');
 for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1], { filename: name });
}
for (const name of fs.readdirSync(path.join(root, '../frontend')).filter(n => n.endsWith('.js'))) execFileSync(process.execPath, ['--check', path.join(root, '../frontend', name)], { stdio: 'inherit' });
console.log('Sintaxe do backend, testes e scripts das páginas: válida.');
