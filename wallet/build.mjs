import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [permission, localPackage, ...extra] = process.argv.slice(2);
if (permission !== '--private-review' || extra.length) {
  console.error('Usage: node wallet/build.mjs --private-review [path-to-packed-wallet-react.tgz]');
  process.exit(1);
}

const project = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'marketplace-wallet-'));
const source = join(temporary, 'source');
const pin = 'c9a594d945f0a93774354139331accaa1f3ef5c5';
const upstream = 'repos/synergy-network-hq/synergy-wallet-connector';

function command(program, args, options) {
  const result = spawnSync(program, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed with exit code ${result.status}`);
  return result.stdout;
}

function pack() {
  if (localPackage) return resolve(localPackage);

  mkdirSync(source);
  const archive = join(temporary, 'connector.tar.gz');
  const output = openSync(archive, 'w', 0o600);
  try {
    command('gh', ['api', `${upstream}/tarball/${pin}`], { stdio: ['ignore', output, 'inherit'] });
  } finally {
    closeSync(output);
  }
  command('tar', ['-xzf', archive, '--strip-components=1', '-C', source]);
  command('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: source });
  command('npm', ['run', 'build'], { cwd: source });
  const packed = command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], {
    cwd: source,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
  return join(temporary, JSON.parse(packed)[0].filename);
}

try {
  const distribution = pack();
  const builder = join(temporary, 'build');
  mkdirSync(builder);
  for (const file of ['wallet-network.js', 'wallet-read-session.js']) {
    copyFileSync(join(project, 'dist', file), join(builder, file));
  }
  copyFileSync(join(project, 'wallet', 'entry.jsx'), join(builder, 'entry.jsx'));
  writeFileSync(join(builder, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    dependencies: {
      '@synergy-network/wallet-react': `file:${distribution}`,
      react: '19.2.0',
      'react-dom': '19.2.0',
      vite: '8.3.4',
    },
  }));
  writeFileSync(join(builder, 'vite.config.js'), `export default {
    base: './', publicDir: false,
    build: {
      sourcemap: false, license: true,
      lib: { entry: 'entry.jsx', formats: ['es'], fileName: 'wallet', cssFileName: 'wallet' },
    },
  };\n`);
  command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: builder });
  command(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: builder });
  copyFileSync(join(builder, 'node_modules', '@synergy-network', 'wallet-react', 'THIRD_PARTY_NOTICES.md'),
    join(builder, 'dist', 'THIRD_PARTY_NOTICES.md'));

  const output = join(project, 'dist', 'wallet-connector');
  rmSync(output, { recursive: true, force: true });
  cpSync(join(builder, 'dist'), output, { recursive: true });
  console.log('Built the private review wallet bundle at dist/wallet-connector/.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
