#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

console.log('--- OpenFishTools Studio Comprehensive Test Suite ---');

function getJsFilesRecursive(dir, excludes = []) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (excludes.some(ex => fullPath === ex || fullPath.startsWith(ex + path.sep) || fullPath.includes(path.sep + ex + path.sep) || entry.name === ex || entry.name.endsWith(ex))) continue;

    if (entry.isDirectory()) {
      files.push(...getJsFilesRecursive(fullPath, excludes));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}
const walkJsFiles = getJsFilesRecursive;

const vendorExcludes = ['vendor', 'node_modules', '.git', '.min.js', 'jszip.min.js'];
const targetDirs = ['js', 'effects', 'scripts', 'element', 'shapes', 'text', 'functions'];
let allJsFiles = [];
targetDirs.forEach(d => {
  allJsFiles.push(...getJsFilesRecursive(d, vendorExcludes));
});
['server.js', 'sw.js', '_worker.js'].forEach(f => {
  if (fs.existsSync(f)) allJsFiles.push(f);
});
allJsFiles = Array.from(new Set(allJsFiles)).sort();

console.log(`\n[1/4] Syntax Verification (node --check) across ${allJsFiles.length} JS files...`);
let syntaxFailures = 0;
allJsFiles.forEach(file => {
  try {
    execFileSync('node', ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    console.error(`  FAIL: Syntax error in ${file}:`, err.message);
    syntaxFailures++;
  }
});
if (syntaxFailures === 0) {
  console.log(`  PASS: All ${allJsFiles.length} files passed syntax verification.`);
} else {
  console.error(`  FAIL: ${syntaxFailures} syntax errors detected.`);
  process.exit(1);
}

console.log('\n[2/4] AST Scope & Undeclared Reference Audit...');
try {
  const auditScript = path.join(__dirname, 'static-scope-audit.js');
  const tmpListPath = path.join(__dirname, '.audit-files.tmp');
  fs.writeFileSync(tmpListPath, allJsFiles.join('\n'), 'utf8');
  let output;
  try {
    output = execFileSync('node', [auditScript, `--file-list=${tmpListPath}`], { encoding: 'utf8' });
  } finally {
    if (fs.existsSync(tmpListPath)) fs.unlinkSync(tmpListPath);
  }
  const lines = output.trim().split('\n');
  const fails = lines.filter(l => l.includes('Undeclared references') || l.includes('ERROR:'));
  if (fails.length > 0) {
    console.error(output);
    console.error(`  FAIL: ${fails.length} files contain undeclared references or errors.`);
    process.exit(1);
  }
  console.log(`  PASS: All ${allJsFiles.length} application files passed scope audit with 0 undeclared references.`);
} catch (err) {
  console.error('  FAIL: Scope audit execution failed:', err.message);
  process.exit(1);
}

console.log('\n[3/4] Synchronizers & System Sanity Check...');
try {
  execFileSync('node', ['scripts/sync-effects.js'], { stdio: 'pipe' });
  execFileSync('node', ['scripts/sync-version.js'], { stdio: 'pipe' });
  console.log('  PASS: Effects and version synchronizers executed cleanly.');
} catch (err) {
  console.error('  FAIL: Synchronizers failed:', err.message);
  process.exit(1);
}

console.log('\n[4/4] HTML File Integrity & Structure Check...');
const expectedHtmlFiles = [
  { file: 'index.html', minLines: 2500 },
  { file: 'editor.html', minLines: 4500 },
  { file: 'desktop.html', minLines: 4500 }
];

let htmlFailures = 0;
for (const item of expectedHtmlFiles) {
  if (!fs.existsSync(item.file)) {
    console.error(`  FAIL: Missing required file ${item.file}`);
    htmlFailures++;
    continue;
  }
  const content = fs.readFileSync(item.file, 'utf8');
  const lines = content.split('\n').length;
  if (!content.includes('</html>')) {
    console.error(`  FAIL: ${item.file} is missing closing </html> tag!`);
    htmlFailures++;
  } else if (lines < item.minLines) {
    console.error(`  FAIL: ${item.file} line count ${lines} is below minimum threshold ${item.minLines}!`);
    htmlFailures++;
  } else {
    console.log(`  PASS: ${item.file} verified (${lines} lines, valid structure).`);
  }
}

if (htmlFailures > 0) {
  console.error(`  FAIL: ${htmlFailures} HTML integrity check(s) failed.`);
  process.exit(1);
}

console.log('\n========================================');
console.log('ALL TESTS PASSED SUCCESSFULLY! (100%)');
console.log('========================================\n');
process.exit(0);
