// Builds the core-wasm package: cargo (wasm32) -> wasm-bindgen (--target web) -> pkg/.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pkgDir, '..', '..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: repoRoot, ...opts });
const capture = (cmd, args) => execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8' });

function fail(message) {
  console.error(`\n[core-wasm] ${message}\n`);
  process.exit(1);
}

// 1. The wasm-bindgen CLI must match the wasm-bindgen crate pinned in Cargo.lock.
const lock = readFileSync(join(repoRoot, 'Cargo.lock'), 'utf8');
const locked = /name = "wasm-bindgen"\r?\nversion = "([^"]+)"/.exec(lock)?.[1];
if (!locked) fail('wasm-bindgen not found in Cargo.lock');
const installHint = `Install the matching CLI with: cargo install wasm-bindgen-cli --version ${locked}`;

let cliVersion;
try {
  cliVersion = /(\d+\.\d+\.\d+)/.exec(capture('wasm-bindgen', ['--version']))?.[1];
} catch {
  fail(`wasm-bindgen CLI not found. ${installHint}`);
}
if (cliVersion !== locked) {
  fail(`wasm-bindgen CLI is ${cliVersion} but Cargo.lock pins ${locked}. ${installHint}`);
}

// 2. Compile the crate for wasm32.
run('cargo', ['build', '-p', 'archviewer-core-wasm', '--release', '--target', 'wasm32-unknown-unknown']);

// 3. Locate the workspace target dir (honours CARGO_TARGET_DIR) and generate bindings.
const targetDir = JSON.parse(capture('cargo', ['metadata', '--format-version', '1', '--no-deps'])).target_directory;
const wasm = join(targetDir, 'wasm32-unknown-unknown', 'release', 'archviewer_core_wasm.wasm');
run('wasm-bindgen', ['--target', 'web', '--out-name', 'core_wasm', '--out-dir', join(pkgDir, 'pkg'), wasm]);
