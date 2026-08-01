import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.resolve(testDir, '../bin/arkts-ts-post-edit.mjs');

function runHook(filePath, cwd) {
  return spawnSync(process.execPath, [hookPath], {
    cwd,
    encoding: 'utf8',
    input: JSON.stringify({
      cwd,
      tool_input: { file_path: filePath }
    })
  });
}

function createFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

test('普通 TypeScript 项目不触发 ArkTS 检查', t => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-hook-normal-'));
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  const filePath = path.join(projectDir, 'src/index.ts');
  createFile(filePath, 'var value: any = 1;\n');

  const result = runHook(filePath, projectDir);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('HarmonyOS 工程中的 TypeScript 文件触发 ArkTS 检查', t => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-hook-harmony-'));
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  createFile(path.join(projectDir, 'build-profile.json5'), '{}\n');
  const filePath = path.join(projectDir, 'entry/src/main/ets/index.ts');
  createFile(filePath, 'var value: any = 1;\n');

  const result = runHook(filePath, projectDir);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /arkts-no-var/);
  assert.match(result.stdout, /arkts-no-any-unknown/);
});

test('ets 文件无需工程标记也会触发 ArkTS 检查', t => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-hook-ets-'));
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  const filePath = path.join(projectDir, 'Index.ets');
  createFile(filePath, 'var value: any = 1;\n');

  const result = runHook(filePath, projectDir);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /arkts-no-var/);
});

test('HarmonyOS 子工程之外的同仓库 TypeScript 文件不触发检查', t => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-hook-workspace-'));
  t.after(() => fs.rmSync(workspaceDir, { recursive: true, force: true }));
  createFile(path.join(workspaceDir, 'harmony-app/build-profile.json5'), '{}\n');
  const filePath = path.join(workspaceDir, 'web-app/src/index.tsx');
  createFile(filePath, 'var value: any = 1;\n');

  const result = runHook(filePath, workspaceDir);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
