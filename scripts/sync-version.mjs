#!/usr/bin/env node
// package.json holds the release version. server.json (what the MCP registry
// publishes) and the image tag pinned in README.md must name the same one.
//
//   node scripts/sync-version.mjs          rewrite server.json and README.md
//   node scripts/sync-version.mjs --check  exit 1 if either one disagrees
//
// `npm version <patch|minor|major>` runs the first form through the `version`
// lifecycle script, so a bump touches all three files at once (and stages them,
// so a tagging `npm version` commits them too).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const IMAGE = 'ghcr.io/stufently/google-webtools-mcp';
// Only SemVer tags (`:<tag>` or `:latest` in prose is left alone), and nothing
// after them: `_..:1.2.3_` in Markdown must not take the closing `_` along.
const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;
const TAG_RE = new RegExp(`${IMAGE.replace(/[.]/g, '\\.')}:${SEMVER}`, 'g');

const read = (f) => readFileSync(root + f, 'utf8');
const version = JSON.parse(read('package.json')).version;
const image = `${IMAGE}:${version}`;
const check = process.argv.includes('--check');

const server = JSON.parse(read('server.json'));
const readme = read('README.md');
const readmeTags = readme.match(TAG_RE) ?? [];

const problems = [];
if (server.version !== version) problems.push(`server.json version is ${server.version}`);
if (server.packages?.[0]?.identifier !== image)
  problems.push(`server.json identifier is ${server.packages?.[0]?.identifier}`);
if (readmeTags.length === 0) problems.push(`README.md pins no ${IMAGE}:<version>`);
for (const tag of new Set(readmeTags)) if (tag !== image) problems.push(`README.md pins ${tag}`);

if (check) {
  if (problems.length) {
    console.error(`package.json is ${version}, but:\n  ${problems.join('\n  ')}`);
    console.error('Run `node scripts/sync-version.mjs` (or bump with `npm version`).');
    process.exit(1);
  }
  console.log(`server.json and README.md agree on ${image}`);
} else {
  if (readmeTags.length === 0) {
    console.error(`README.md pins no ${IMAGE}:<version>; nothing to update there`);
    process.exit(1);
  }
  server.version = version;
  server.packages[0].identifier = image;
  writeFileSync(root + 'server.json', JSON.stringify(server, null, 2) + '\n');
  writeFileSync(root + 'README.md', readme.replace(TAG_RE, image));
  console.log(`server.json and README.md now name ${image}`);
  // Under `npm version` with git tagging on, npm commits only package.json and
  // the lockfile; stage these too so the commit and tag carry them. Staging is
  // harmless otherwise, and where git is missing or fails (a node container)
  // the files are simply left for you to commit.
  if (process.env.npm_lifecycle_event === 'version') {
    const r = spawnSync('git', ['add', 'server.json', 'README.md'], { cwd: root, stdio: 'inherit' });
    if (r.error || r.status) console.error('note: server.json and README.md not staged; commit them yourself');
  }
}
