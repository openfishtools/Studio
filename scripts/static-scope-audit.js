const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const STUDIO_ROOT = path.resolve(__dirname, '..');

const BUILTIN_GLOBALS = new Set([
  // JS Builtins & Web APIs
  'window', 'Window', 'document', 'navigator', 'console', 'location', 'history',
  'localStorage', 'sessionStorage', 'performance', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'fetch', 'alert', 'confirm', 'prompt', 'Math', 'JSON', 'Object', 'Array',
  'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'TypeError',
  'RangeError', 'SyntaxError', 'ReferenceError', 'Promise', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect', 'Int8Array', 'Uint8Array',
  'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'BigInt', 'BigInt64Array', 'BigUint64Array',
  'ArrayBuffer', 'DataView', 'Blob', 'File', 'FileReader', 'FormData', 'Image',
  'Audio', 'AudioContext', 'OfflineAudioContext', 'webkitAudioContext',
  'CanvasRenderingContext2D', 'Path2D', 'ImageData', 'HTMLCanvasElement',
  'HTMLVideoElement', 'HTMLAudioElement', 'HTMLImageElement', 'HTMLElement',
  'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'PointerEvent', 'TouchEvent', 'DragEvent', 'WheelEvent', 'ResizeObserver',
  'IntersectionObserver', 'MutationObserver', 'AbortController', 'URL',
  'URLSearchParams', 'btoa', 'atob', 'encodeURI', 'decodeURI', 'encodeURIComponent',
  'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'escape',
  'unescape', 'crypto', 'indexedDB', 'IDBKeyRange', 'XMLHttpRequest', 'WebSocket',
  'Worker', 'OffscreenCanvas', 'CSS', 'getComputedStyle', 'matchMedia',
  'WebGLRenderingContext', 'WebGL2RenderingContext', 'createImageBitmap',
  'queueMicrotask', 'structuredClone', 'self', 'globalThis', 'top', 'parent',
  'frames', 'screen', 'event', 'screenX', 'screenY', 'innerWidth', 'innerHeight',
  'scrollX', 'scrollY', 'devicePixelRatio', 'AudioDecoder', 'VideoDecoder',
  'VideoFrame', 'EncodedVideoChunk', 'MediaStream', 'MediaRecorder',
  'EyeDropper', 'ClipboardItem', 'showOpenFilePicker', 'showSaveFilePicker',
  'WebGLTexture', 'WebGLBuffer', 'WebGLProgram', 'WebGLShader', 'WebGLFramebuffer',
  'VideoEncoder', 'AudioEncoder', 'AudioData', 'scheduler', 'MessageChannel',
  'caches', 'Response', 'ImageBitmap', 'requestIdleCallback', 'cancelIdleCallback',
  'undefined', 'Infinity', 'NaN', 'arguments', 'TextEncoder', 'TextDecoder',
  'DOMParser', 'XMLSerializer', 'Intl', 'eval', 'Function', 'SharedArrayBuffer',
  'Atomics', 'WebAssembly', 'Request', 'ReadableStream', 'AbortSignal', 'Headers',

  // Environment & External Vendor / Test Globals
  'module', 'exports', 'require', '__dirname', '__filename', 'process',
  'electronAPI', 'electronBridge', 'tauri', '__TAURI__', '__TAURI_INTERNALS__',
  'global', 'define', 'Buffer', 'setImmediate', 'clearImmediate',
  'JSZip', 'Mp4Muxer', 'lamejs', 'createFFmpeg',
  'describe', 'it', 'before', 'after', 'beforeEach', 'afterEach', 'assert'
]);

// Keep backward-compatible alias for tests inspecting KNOWN_GLOBALS
const KNOWN_GLOBALS = BUILTIN_GLOBALS;

function getAllProjectJsFiles() {
  const dirs = ['js', 'effects', 'scripts', 'element', 'shapes', 'text', 'functions'];
  const excludes = ['vendor', 'node_modules', '.git', '.min.js', 'jszip.min.js'];
  const files = [];

  function walkDir(dir) {
    const fullDir = path.isAbsolute(dir) ? dir : path.join(STUDIO_ROOT, dir);
    if (!fs.existsSync(fullDir)) return;
    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.') || (ent.name.startsWith('_') && ent.name !== '_worker.js') || ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'vendor') continue;
      const sub = path.join(fullDir, ent.name);
      if (excludes.some(ex => sub.includes(ex))) continue;
      if (ent.isDirectory()) {
        walkDir(sub);
      } else if (ent.isFile() && ent.name.endsWith('.js') && !ent.name.includes('.min.js') && !ent.name.endsWith('.test.js')) {
        files.push(sub);
      }
    }
  }

  dirs.forEach(walkDir);
  ['server.js', 'sw.js', '_worker.js'].forEach(f => {
    const p = path.join(STUDIO_ROOT, f);
    if (fs.existsSync(p)) files.push(p);
  });
  return Array.from(new Set(files));
}

let dynamicGlobalsCache = null;

function collectExportedGlobals(files = null) {
  if (!files && dynamicGlobalsCache) return dynamicGlobalsCache;
  const exported = new Set();
  const targetFiles = files || getAllProjectJsFiles();

  for (const file of targetFiles) {
    let code;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch (_) {
      continue;
    }

    let ast;
    let isModule = false;
    try {
      ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true
      });
    } catch (_) {
      try {
        ast = acorn.parse(code, {
          ecmaVersion: 'latest',
          sourceType: 'module',
          allowReturnOutsideFunction: true,
          allowAwaitOutsideFunction: true
        });
        isModule = true;
      } catch (_) {
        continue;
      }
    }

    walk.simple(ast, {
      AssignmentExpression(node) {
        if (node.left.type === 'MemberExpression') {
          const obj = node.left.object;
          const prop = node.left.property;
          const isGlobalObj = (obj.type === 'Identifier' && (obj.name === 'window' || obj.name === 'globalThis' || obj.name === 'self' || obj.name === 'global')) ||
                              (obj.type === 'MemberExpression' && obj.property && obj.property.name === 'window');
          if (isGlobalObj) {
            if (prop.type === 'Identifier' && !node.left.computed) {
              exported.add(prop.name);
            } else if (prop.type === 'Literal' && typeof prop.value === 'string') {
              exported.add(prop.value);
            }
          }
        }
      },
      CallExpression(node) {
        if (node.callee.type === 'MemberExpression' &&
            node.callee.object.type === 'Identifier' && node.callee.object.name === 'Object' &&
            node.callee.property.type === 'Identifier' && node.callee.property.name === 'defineProperty') {
          if (node.arguments.length >= 2) {
            const target = node.arguments[0];
            const propName = node.arguments[1];
            if (target.type === 'Identifier' && (target.name === 'window' || target.name === 'globalThis' || target.name === 'self' || target.name === 'global')) {
              if (propName.type === 'Literal' && typeof propName.value === 'string') {
                exported.add(propName.value);
              }
            }
          }
        }
      },
      Program(node) {
        const isNodeOnly = file.includes(path.sep + 'scripts' + path.sep) || file.endsWith('server.js') || file.endsWith('_worker.js');
        if (isNodeOnly || isModule) return;
        for (const item of node.body) {
          if (item.type === 'FunctionDeclaration' && item.id) {
            exported.add(item.id.name);
          } else if (item.type === 'ClassDeclaration' && item.id) {
            exported.add(item.id.name);
          } else if (item.type === 'VariableDeclaration' && item.kind === 'var') {
            for (const d of item.declarations) {
              extractPatternDeclarations(d.id, name => exported.add(name));
            }
          }
        }
      }
    });
  }

  if (!files) dynamicGlobalsCache = exported;
  return exported;
}

let effectiveGlobalsCache = null;

function getEffectiveGlobals(customFiles = null) {
  const dynamic = collectExportedGlobals(customFiles);
  effectiveGlobalsCache = new Set([...BUILTIN_GLOBALS, ...dynamic]);
  return effectiveGlobalsCache;
}

class Scope {
  constructor(parent = null, isFunction = false) {
    this.parent = parent;
    this.isFunction = isFunction;
    this.declarations = new Set();
  }

  add(name) {
    this.declarations.add(name);
  }

  has(name) {
    if (this.declarations.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  hasFunctionScope(name) {
    if (this.declarations.has(name)) return true;
    if (this.isFunction) return false;
    if (this.parent) return this.parent.hasFunctionScope(name);
    return false;
  }
}

function extractPatternDeclarations(node, addFn) {
  if (!node) return;
  if (node.type === 'Identifier') {
    addFn(node.name);
  } else if (node.type === 'AssignmentPattern') {
    extractPatternDeclarations(node.left, addFn);
  } else if (node.type === 'RestElement') {
    extractPatternDeclarations(node.argument, addFn);
  } else if (node.type === 'ArrayPattern') {
    for (const elem of node.elements) {
      if (elem) extractPatternDeclarations(elem, addFn);
    }
  } else if (node.type === 'ObjectPattern') {
    for (const prop of node.properties) {
      if (prop.type === 'Property') {
        extractPatternDeclarations(prop.value, addFn);
      } else if (prop.type === 'RestElement') {
        extractPatternDeclarations(prop.argument, addFn);
      }
    }
  }
}

function analyzeFile(filePath, customGlobals = null) {
  const effectiveGlobals = customGlobals || effectiveGlobalsCache || (effectiveGlobalsCache = getEffectiveGlobals());
  const code = fs.readFileSync(filePath, 'utf8');
  let ast;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true
    });
  } catch (err) {
    if (err.message.includes('sourceType: module') || err.message.includes('import') || err.message.includes('export')) {
      try {
        ast = acorn.parse(code, {
          ecmaVersion: 'latest',
          sourceType: 'module',
          locations: true,
          allowReturnOutsideFunction: true,
          allowAwaitOutsideFunction: true
        });
      } catch (esmErr) {
        return { error: `Parse error (module): ${esmErr.message} at line ${esmErr.loc ? esmErr.loc.line : '?'}` };
      }
    } else {
      return { error: `Parse error: ${err.message} at line ${err.loc ? err.loc.line : '?'}` };
    }
  }

  const undeclaredUses = [];
  const implicitGlobals = [];

  let currentScope = new Scope(null, true);

  function getFunctionScope(scope) {
    let s = scope;
    while (s && !s.isFunction) s = s.parent;
    return s || scope;
  }

  walk.ancestor(ast, {
    Program(node, ancestors) {
      for (const item of node.body) {
        if (item.type === 'FunctionDeclaration' && item.id) {
          currentScope.add(item.id.name);
        } else if (item.type === 'ClassDeclaration' && item.id) {
          currentScope.add(item.id.name);
        } else if (item.type === 'VariableDeclaration') {
          for (const decl of item.declarations) {
            extractPatternDeclarations(decl.id, name => currentScope.add(name));
          }
        } else if (item.type === 'ImportDeclaration') {
          for (const spec of item.specifiers) {
            if (spec.local && spec.local.name) {
              currentScope.add(spec.local.name);
            }
          }
        } else if (item.type === 'ExportNamedDeclaration') {
          if (item.declaration) {
            if (item.declaration.type === 'FunctionDeclaration' && item.declaration.id) {
              currentScope.add(item.declaration.id.name);
            } else if (item.declaration.type === 'ClassDeclaration' && item.declaration.id) {
              currentScope.add(item.declaration.id.name);
            } else if (item.declaration.type === 'VariableDeclaration') {
              for (const decl of item.declaration.declarations) {
                extractPatternDeclarations(decl.id, name => currentScope.add(name));
              }
            }
          }
        } else if (item.type === 'ExportDefaultDeclaration') {
          if (item.declaration && item.declaration.id && item.declaration.id.name) {
            currentScope.add(item.declaration.id.name);
          }
        }
      }
    },
    FunctionDeclaration(node, ancestors) {
      if (node.id) {
        const fnScope = getFunctionScope(currentScope);
        fnScope.add(node.id.name);
      }
    }
  });

  function enterScope(isFunction = false) {
    currentScope = new Scope(currentScope, isFunction);
  }

  function exitScope() {
    currentScope = currentScope.parent;
  }

  function visit(node, parent) {
    if (!node) return;

    const isScopeNode =
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'BlockStatement' ||
      node.type === 'ForStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement' ||
      node.type === 'CatchClause';

    const isFunction =
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression';

    if (isScopeNode) {
      enterScope(isFunction);

      if (isFunction && node.params) {
        for (const param of node.params) {
          extractPatternDeclarations(param, name => currentScope.add(name));
        }
      }
      if (node.type === 'CatchClause' && node.param) {
        extractPatternDeclarations(node.param, name => currentScope.add(name));
      }
      if (node.type === 'FunctionExpression' && node.id) {
        currentScope.add(node.id.name);
      }

      const body = node.body ? (Array.isArray(node.body) ? node.body : (node.body.body || [])) : [];
      if (Array.isArray(body)) {
        for (const stmt of body) {
          if (stmt.type === 'FunctionDeclaration' && stmt.id) {
            currentScope.add(stmt.id.name);
          } else if (stmt.type === 'ClassDeclaration' && stmt.id) {
            currentScope.add(stmt.id.name);
          } else if (stmt.type === 'VariableDeclaration') {
            if (stmt.kind === 'var') {
              const fnScope = getFunctionScope(currentScope);
              for (const decl of stmt.declarations) {
                extractPatternDeclarations(decl.id, name => fnScope.add(name));
              }
            } else {
              for (const decl of stmt.declarations) {
                extractPatternDeclarations(decl.id, name => currentScope.add(name));
              }
            }
          }
        }
      }
    }

    if (node.type === 'VariableDeclaration' && parent && parent.type !== 'Program' && parent.type !== 'BlockStatement') {
      const targetScope = node.kind === 'var' ? getFunctionScope(currentScope) : currentScope;
      for (const decl of node.declarations) {
        extractPatternDeclarations(decl.id, name => targetScope.add(name));
      }
    }

    if (node.type === 'AssignmentExpression') {
      if (node.left.type === 'Identifier') {
        const name = node.left.name;
        if (!currentScope.has(name) && !effectiveGlobals.has(name)) {
          implicitGlobals.push({
            name,
            line: node.loc.start.line,
            col: node.loc.start.column
          });
        }
      }
    }

    if (node.type === 'Identifier') {
      const name = node.name;
      const isRef = isReference(node, parent);
      if (isRef && !currentScope.has(name) && !effectiveGlobals.has(name)) {
        if (!(parent && parent.type === 'UnaryExpression' && parent.operator === 'typeof')) {
          undeclaredUses.push({
            name,
            line: node.loc.start.line,
            col: node.loc.start.column
          });
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range' || key === 'comments') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c.type === 'string') visit(c, node);
        }
      } else if (child && typeof child.type === 'string') {
        visit(child, node);
      }
    }

    if (isScopeNode) {
      exitScope();
    }
  }

  visit(ast, null);

  return { undeclaredUses, implicitGlobals };
}

function isReference(node, parent) {
  if (!parent) return true;
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) {
    return false;
  }
  if (parent.type === 'Property' && parent.key === node && !parent.computed) {
    return false;
  }
  if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) {
    return false;
  }
  if (parent.type === 'VariableDeclarator' && parent.id === node) {
    return false;
  }
  if (parent.type === 'FunctionDeclaration' && parent.id === node) {
    return false;
  }
  if (parent.type === 'FunctionExpression' && parent.id === node) {
    return false;
  }
  if (parent.type === 'ClassDeclaration' && parent.id === node) {
    return false;
  }
  if (parent.type === 'CatchClause' && parent.param === node) {
    return false;
  }
  if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier') {
    return false;
  }
  if (parent.type === 'ExportSpecifier' && parent.exported === node) {
    return false;
  }
  if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') {
    return false;
  }
  return true;
}

module.exports = { analyzeFile, collectExportedGlobals, getEffectiveGlobals, BUILTIN_GLOBALS, KNOWN_GLOBALS };

if (require.main === module) {
  const rawArgs = process.argv.slice(2);
  let targetFiles = [];

  function collectFiles(p) {
    if (!fs.existsSync(p)) return;
    const stat = fs.statSync(p);
    if (stat.isFile() && p.endsWith('.js')) {
      if (!p.includes('jszip.min.js') && !p.includes('vendor' + path.sep) && !p.endsWith('.min.js')) {
        targetFiles.push(p);
      }
    } else if (stat.isDirectory()) {
      const entries = fs.readdirSync(p, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'vendor') continue;
        const sub = path.join(p, ent.name);
        if (ent.isDirectory()) {
          collectFiles(sub);
        } else if (ent.isFile() && ent.name.endsWith('.js') && !ent.name.includes('.min.js')) {
          targetFiles.push(sub);
        }
      }
    }
  }

  const fileListArg = rawArgs.find(a => a.startsWith('--file-list='));
  if (fileListArg) {
    const listPath = fileListArg.slice('--file-list='.length);
    if (fs.existsSync(listPath)) {
      const listContent = fs.readFileSync(listPath, 'utf8');
      const lines = listContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      lines.forEach(collectFiles);
    }
  } else if (rawArgs.includes('--stdin') || rawArgs.includes('-')) {
    const listContent = fs.readFileSync(0, 'utf8');
    const lines = listContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.forEach(collectFiles);
  } else if (rawArgs.length === 0) {
    ['js', 'effects', 'scripts', 'element', 'shapes', 'text', 'functions'].forEach(collectFiles);
    ['server.js', 'sw.js', '_worker.js'].forEach(f => {
      if (fs.existsSync(f)) targetFiles.push(f);
    });
  } else {
    rawArgs.forEach(arg => collectFiles(arg));
  }

  targetFiles = Array.from(new Set(targetFiles)).sort();
  const effectiveGlobals = getEffectiveGlobals();

  let hasErrors = false;
  for (const f of targetFiles) {
    console.log(`Analyzing ${f}...`);
    const res = analyzeFile(f, effectiveGlobals);
    if (res.error) {
      console.error(`  ERROR: ${res.error}`);
      hasErrors = true;
    } else {
      if (res.implicitGlobals.length > 0) {
        console.log(`  Implicit global assignments (${res.implicitGlobals.length}):`);
        for (const item of res.implicitGlobals.slice(0, 20)) {
          console.log(`    Line ${item.line}:${item.col} - ${item.name}`);
        }
        hasErrors = true;
      }
      if (res.undeclaredUses.length > 0) {
        console.log(`  Undeclared references (${res.undeclaredUses.length}):`);
        const byName = {};
        for (const item of res.undeclaredUses) {
          byName[item.name] = byName[item.name] || [];
          byName[item.name].push(item.line);
        }
        for (const [name, lines] of Object.entries(byName)) {
          console.log(`    "${name}" on lines: ${lines.slice(0, 8).join(', ')}${lines.length > 8 ? ` (+${lines.length - 8} more)` : ''}`);
        }
        hasErrors = true;
      }
      if (res.implicitGlobals.length === 0 && res.undeclaredUses.length === 0) {
        console.log(`  PASS: No issues found.`);
      }
    }
  }
  if (hasErrors) {
    process.exit(1);
  }
}
