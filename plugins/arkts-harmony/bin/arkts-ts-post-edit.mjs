#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

function normalizePatchPath(rawPath) {
  const filePath = rawPath
    .replace(/^"(.*)"$/, '$1')
    .replace(/^(?:a|b)\//, '')
    .split(/\t|\s+\d{4}-\d{2}-\d{2}\s/)[0]
    .trim();
  if (!filePath || filePath === '/dev/null') return '';
  return filePath;
}

function resolveCandidatePath(filePath, cwd) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}

function getCandidatePaths(input) {
  const paths = new Set();
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const toolInput = input.tool_input || input.toolInput || {};
  if (typeof toolInput.file_path === 'string') paths.add(resolveCandidatePath(toolInput.file_path, cwd));
  if (typeof toolInput.path === 'string') paths.add(resolveCandidatePath(toolInput.path, cwd));
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      if (edit && typeof edit.file_path === 'string') paths.add(resolveCandidatePath(edit.file_path, cwd));
      if (edit && typeof edit.path === 'string') paths.add(resolveCandidatePath(edit.path, cwd));
    }
  }
  const patch = toolInput.patch || toolInput.command || toolInput.input || input.patch;
  if (typeof patch === 'string') {
    for (const line of patch.split(/\r?\n/)) {
      const match = /^(?:\*\*\* (?:Add|Update) File:|\+\+\+)\s+(.+)$/.exec(line);
      if (!match) continue;
      const filePath = normalizePatchPath(match[1]);
      if (filePath) paths.add(resolveCandidatePath(filePath, cwd));
    }
  }
  return Array.from(paths).filter(Boolean);
}

const checks = [
  { id: 'arkts-no-var', level: 'error', regex: /\bvar\s+[A-Za-z_$]/, message: 'ArkTS 不支持 var，改用 let 或 const。' },
  { id: 'arkts-no-any-unknown', level: 'error', regex: /:\s*(any|unknown)\b|\bas\s+(any|unknown)\b/, message: 'ArkTS 不支持 any/unknown，改为具体类型、Record、Object 或 ESObject 边界类型。' },
  { id: 'arkts-no-private-identifiers', level: 'error', regex: /(^|[^\w$])#[A-Za-z_$][\w$]*/m, message: 'ArkTS 不支持 #private 字段，改用 private。' },
  { id: 'arkts-no-ctor-prop-decls', level: 'error', regex: /constructor\s*\([^)]*\b(public|private|protected|readonly)\s+[A-Za-z_$]/s, message: 'ArkTS 不支持在 constructor 参数里声明类字段，字段需在 class 内显式声明。' },
  { id: 'arkts-no-indexed-signatures', level: 'error', regex: /\{\s*\[[A-Za-z_$][\w$]*\s*:\s*(string|number|symbol)\]\s*:/s, message: 'ArkTS 不支持 index signature，按场景改用 Record、数组、Map 或 class。' },
  { id: 'arkts-no-intersection-types', level: 'error', regex: /\btype\s+[A-Za-z_$][\w$]*[^=]*=\s*[^;\n]+\s&\s[^;\n]+/, message: 'ArkTS 不支持 intersection type，改用 interface extends 或显式类型建模。' },
  { id: 'arkts-no-typing-with-this', level: 'error', regex: /:\s*this\b|\bthis\s*[,)]/, message: 'ArkTS 不支持 this 类型，改用具体类名或接口名。' },
  { id: 'arkts-no-regexp-literals', level: 'warning', regex: /=\s*\/(?:\\.|[^/\n])+\/[gimsuy]*/, message: 'ArkTS 场景建议用 new RegExp(pattern, flags) 替代正则字面量，尤其是带 flags 的正则。' },
  { id: 'arkts-no-as-const', level: 'error', regex: /\bas\s+const\b/, message: 'ArkTS 不支持 as const，改用显式类型、readonly 字段或常量对象建模。' },
  { id: 'arkts-no-func-apply-call-bind', level: 'error', regex: /\.\s*(apply|call|bind)\s*\(/, message: 'ArkTS 限制 Function.apply/call/bind，改为直接调用、箭头函数封装或显式参数传递。' },
  { id: 'arkts-no-delete', level: 'error', regex: /\bdelete\s+[A-Za-z_$]/, message: 'ArkTS 不允许运行时删除对象属性，避免改变对象布局。' },
  { id: 'arkts-no-eval-with-new-function', level: 'error', regex: /\beval\s*\(|\bwith\s*\(|new\s+Function\s*\(/, message: 'ArkTS/鸿蒙运行环境限制 eval、with、字符串创建函数。' },
  { id: 'arkts-no-tsdeps', level: 'error', regex: /import\s+(?:[^'\"]+from\s+)?['\"][^'\"]+\.ets['\"]/, message: '.ts/.js 不应直接 import .ets 源码；改为 .ets 适配或抽公共 .ts。', tsOnly: true },
  { id: 'performance-optional-params', level: 'suggestion', regex: /function\s+[A-Za-z_$][\w$]*\s*\([^)]*\?\s*:/s, message: '性能敏感函数避免可选参数，可改必选参数或默认参数，减少 undefined 判断。' },
  { id: 'performance-sparse-array', level: 'warning', regex: /new\s+Array\s*<[^>]+>\s*\(\s*[1-9]\d{3,}\s*\)|\[[^\]]*\]\s*;?\s*\n[^\n]*\[\s*[1-9]\d{3,}\s*\]\s*=/s, message: '避免大尺寸空数组或稀疏数组，ArkTS 运行时可能走 hash 表慢路径。' }
];

function scanFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.ets', '.ts', '.tsx'].includes(ext)) return [];
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const findings = [];
  for (const check of checks) {
    if (check.tsOnly && !['.ts', '.tsx'].includes(ext)) continue;
    const m = check.regex.exec(content);
    if (m) {
      const prefix = content.slice(0, m.index);
      const line = prefix.split(/\r?\n/).length;
      findings.push({ ...check, line });
    }
  }
  return findings;
}

(async () => {
  let input = {};
  try {
    const raw = await readStdin();
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch (_) {
    input = {};
  }

  const files = getCandidatePaths(input);
  const reports = [];
  for (const file of files) {
    const findings = scanFile(file);
    if (findings.length) reports.push({ file, findings });
  }

  if (!reports.length) process.exit(0);

  const root = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
  const lines = [];
  lines.push('ArkTS/TS PostToolUse 自动检查发现可能问题。请结合 skill `arkts-ts-rules` 和完整资料确认后再改。');
  lines.push(`完整资料目录：${root}/skills/arkts-ts-rules/references/original-docs/`);
  for (const report of reports) {
    lines.push(`\n文件：${report.file}`);
    for (const f of report.findings) {
      lines.push(`- [${f.level}] ${f.id} @ line ${f.line}: ${f.message}`);
    }
  }

  const output = {
    systemMessage: lines.join('\n'),
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: lines.join('\n')
    }
  };
  process.stdout.write(JSON.stringify(output));
})();
