// 使用已有 TypeScript 编译器检查所有源码语法，不构建、不运行扩展。
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '..');
let checked = 0, errors = 0;
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', '.wxt', '.output', '.artifacts'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (/\.tsx?$/.test(entry.name)) {
      const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        fileName: file, reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      });
      for (const diagnostic of result.diagnostics || []) {
        if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
        errors++;
        process.stderr.write(`${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}\n`);
      }
      checked++;
    }
  }
}
visit(root);
process.stdout.write(`已检查 ${checked} 个源码文件，语法错误 ${errors} 个。此检查不代替完整类型检查。\n`);
process.exitCode = errors ? 1 : 0;
