import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const processes = [
  spawn(process.execPath, ['--watch', 'server/index.mjs'], { cwd: root, stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '--workspace', 'web'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }),
];
function shutdown() { for (const child of processes) if (!child.killed) child.kill('SIGTERM'); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
processes.forEach(child => child.on('exit', (code) => {
  if (code && code !== 0) { shutdown(); process.exitCode = code; }
}));
