#!/usr/bin/env node
const { execSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const run = (cmd, opts = {}) => {
  execSync(cmd, { stdio: 'inherit', ...opts });
};

try {
  const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
  process.chdir(repoRoot);
} catch (err) {
  console.error('This script must be run inside the git repository.');
  process.exit(1);
}

const stashName = `pull-repair-${Date.now()}`;

try {
  if (existsSync(path.join('.git', 'MERGE_HEAD'))) {
    console.log('\nAborting unfinished merge...');
    run('git merge --abort');
  }
} catch (err) {
  console.warn('No merge to abort or merge abort failed. Continuing...');
}

try {
  console.log(`\nStashing current work as ${stashName} (includes untracked files)...`);
  run(`git stash push --include-untracked -m "${stashName}"`);
} catch (err) {
  console.warn('Nothing to stash or stash failed. Continuing...');
}

console.log('\nResetting tracked files to the last commit...');
run('git reset --hard HEAD');

console.log('\nCleaning untracked files/folders...');
run('git clean -fd');

console.log('\nEnsuring local main matches remote main...');
run('git fetch origin main');
run('git checkout main');
run('git pull origin main');

console.log('\nDone!');
console.log('If you stashed work, reapply it with: git stash pop');
console.log(`Look for stash entry named: ${stashName}`);
