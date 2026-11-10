const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
const { releases } = require('../public/changelog.json');

// Validate the commit inputs, not just files that happen to exist locally.
execFileSync('git', ['ls-files', '--error-unmatch',
  'public/js/release-notes.js', 'public/changelog.json', 'services/app-version.js',
  'scripts/check-release.cjs', 'tests/app-version.test.cjs', 'docs/releases.md'
], { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' });

assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'Use a stable semantic version');
assert.equal(lock.version, pkg.version, 'Lockfile version must match package.json');
assert.equal(lock.packages[''].version, pkg.version, 'Lockfile root package must match');
assert.equal(new Set(releases.map(r => r.version)).size, releases.length, 'Release versions must be unique');
assert.ok(releases.some(r => r.version === pkg.version), 'Add notes for the current package version');
for (const release of releases) {
  assert.match(release.version, /^\d+\.\d+\.\d+$/);
  assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(release.date).toISOString().slice(0, 10), release.date);
  for (const key of ['features', 'improvements', 'fixes']) {
    assert.ok(Array.isArray(release[key]) && release[key].every(item => typeof item === 'string' && item.trim()), `${release.version}: invalid ${key}`);
  }
}
console.log(`Release metadata verified: v${pkg.version}`);
