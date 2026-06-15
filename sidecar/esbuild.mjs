/**
 * esbuild config for the sidecar bundles.
 *
 * Mirrors upstream `esbuild.mjs` worker handling: each entry is bundled as a
 * standalone Node/CJS file so the worker model (`child_process.fork` for the
 * parse worker, `worker_threads` for the warm-up worker) keeps running upstream's
 * code unmodified.
 *
 * Two of the five Node entries — `main` and `mcp-main` — are the sidecar's own
 * entry points and are added in part 2. The three worker entries come from the
 * vendored upstream core. Entries whose source file is not present yet are
 * skipped and reported (never silently dropped), so this config lights up the
 * remaining bundles automatically as their sources land.
 *
 * The sixth bundle is the **webview** (part 3): `vendor/webview/app.ts` is built
 * as a browser IIFE and the four CSS layers are concatenated, byte-for-byte the
 * same as upstream's `esbuild.mjs`, into `dist/webview/`. The plugin's Gradle
 * `processResources` folds `dist/webview/{app.js,styles.css}` into the JAR, where
 * `AssetSchemeHandler` serves them to JCEF. Keeping the webview build here (next
 * to the chart.js dependency and the vendored source) means one `npm run build`
 * produces every artifact the plugin ships.
 */

import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIDECAR_DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(SIDECAR_DIR, 'dist');
const isWatch = process.argv.includes('--watch');

// outfile (relative to dist/) -> entry source (relative to sidecar/)
const BUNDLES = [
  { out: 'main.js', entry: 'src/main.ts' },
  { out: 'mcp-main.js', entry: 'src/mcp-main.ts' },
  { out: 'parse-worker.js', entry: 'vendor/core/parse-worker.ts' },
  { out: 'warm-up-worker.js', entry: 'vendor/core/warm-up-worker.ts' },
  { out: 'cache-write-worker.js', entry: 'vendor/core/cache-write-worker.ts' },
];

// The webview client bundle: a browser IIFE, not a Node CJS module. Its entry
// and CSS layers live in the vendored upstream snapshot.
const WEBVIEW = {
  entry: 'vendor/webview/app.ts',
  out: 'webview/app.js',
  cssOut: 'webview/styles.css',
  // Concatenation order is upstream's `cssSources` — keep it byte-identical.
  cssSources: [
    'vendor/webview/styles.css',
    'vendor/webview/styles-pages.css',
    'vendor/webview/styles-skills.css',
    'vendor/webview/styles-learning.css',
  ],
};

function commonOptions(entry, out) {
  return {
    entryPoints: [path.join(SIDECAR_DIR, entry)],
    outfile: path.join(DIST_DIR, out),
    bundle: true,
    platform: 'node',
    target: 'es2022',
    format: 'cjs',
    sourcemap: true,
    // `vscode` is never reachable in the sidecar, but the vendored code carries
    // lazy `require('vscode')` guards; mark it external to match upstream and
    // keep esbuild from trying to resolve it.
    external: ['vscode'],
  };
}

function webviewOptions() {
  return {
    entryPoints: [path.join(SIDECAR_DIR, WEBVIEW.entry)],
    outfile: path.join(DIST_DIR, WEBVIEW.out),
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    sourcemap: true,
  };
}

/** Concatenate the CSS layers into a single stylesheet, mirroring upstream. */
function bundleWebviewCss() {
  const bundled = WEBVIEW.cssSources
    .map((source) => fs.readFileSync(path.join(SIDECAR_DIR, source), 'utf-8').trimEnd())
    .join('\n\n');
  fs.writeFileSync(path.join(DIST_DIR, WEBVIEW.cssOut), `${bundled}\n`);
}

const webviewPresent = fs.existsSync(path.join(SIDECAR_DIR, WEBVIEW.entry));

function copyMarkdownAssets() {
  const assets = [
    { src: 'vendor/core/rules', dest: 'rules', filter: f => f.endsWith('.md') },
    { src: 'vendor/core/metrics', dest: 'metrics', filter: f => f.endsWith('.metric.md') },
  ];
  for (const { src, dest, filter } of assets) {
    const srcDir = path.join(SIDECAR_DIR, src);
    if (!fs.existsSync(srcDir)) {
      console.warn(`Warning: asset dir missing, skipping: ${src} (run the sync script to populate vendor/)`);
      continue;
    }
    const destDir = path.join(DIST_DIR, dest);
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir).filter(filter)) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    }
  }
}

const present = [];
const skipped = [];
for (const bundle of BUNDLES) {
  if (fs.existsSync(path.join(SIDECAR_DIR, bundle.entry))) present.push(bundle);
  else skipped.push(bundle);
}

if (present.length === 0) {
  console.error('No bundle sources found. Run `node ../tools/sync-upstream.mjs` to populate vendor/.');
  process.exit(1);
}

fs.mkdirSync(DIST_DIR, { recursive: true });
fs.mkdirSync(path.join(DIST_DIR, 'webview'), { recursive: true });

if (isWatch) {
  const contexts = await Promise.all(
    present.map(b => esbuild.context(commonOptions(b.entry, b.out)))
  );
  if (webviewPresent) {
    const webviewCtx = await esbuild.context(webviewOptions());
    contexts.push(webviewCtx);
    bundleWebviewCss();
    for (const source of WEBVIEW.cssSources) {
      fs.watch(path.join(SIDECAR_DIR, source), () => {
        try { bundleWebviewCss(); console.log(`CSS rebuilt (${source} changed)`); }
        catch (err) { console.error('CSS rebuild failed:', err); }
      });
    }
  }
  await Promise.all(contexts.map(ctx => ctx.watch()));
  copyMarkdownAssets();
  console.log(`Watching ${contexts.length} bundle(s) for changes...`);
} else {
  const builds = present.map(b => esbuild.build(commonOptions(b.entry, b.out)));
  if (webviewPresent) builds.push(esbuild.build(webviewOptions()));
  await Promise.all(builds);
  if (webviewPresent) bundleWebviewCss();
  copyMarkdownAssets();
  const built = [...present.map(b => b.out), ...(webviewPresent ? [WEBVIEW.out, WEBVIEW.cssOut] : [])];
  console.log(`Built ${built.length} bundle(s): ${built.join(', ')}`);
}

if (!webviewPresent) skipped.push(WEBVIEW);
if (skipped.length > 0) {
  console.log(`Skipped ${skipped.length} bundle(s) (source not present yet): ${skipped.map(b => b.out).join(', ')}`);
}
