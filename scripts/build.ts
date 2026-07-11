// Bundles src/index.tsx and compiles it to a single self-contained binary.
// A plain `bun build --compile` fails because ink's devtools module statically
// imports react-devtools-core (an optional, uninstalled peer) and bun's
// compiler evaluates the flattened dynamic import eagerly; we stub it out.
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const bundle = path.join(root, 'dist', 'bundle.js');

const result = await Bun.build({
  entrypoints: [path.join(root, 'src', 'index.tsx')],
  target: 'bun',
  outdir: path.join(root, 'dist'),
  naming: 'bundle.js',
  plugins: [
    {
      name: 'stub-react-devtools-core',
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: path.join(root, 'scripts', 'stub-react-devtools-core.ts'),
        }));
      },
    },
  ],
});
if (!result.success) {
  console.error(result.logs.join('\n'));
  process.exit(1);
}

const proc = Bun.spawnSync(
  ['bun', 'build', '--compile', bundle, '--outfile', path.join(root, 'dist', 'beads-view')],
  { stdout: 'inherit', stderr: 'inherit' },
);
process.exit(proc.exitCode ?? 1);
