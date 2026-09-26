import { strict as assert } from 'node:assert';
import { parseGitHubRepository } from '../src/lib/githubRepository';

for (const remote of [
  'https://github.com/octocat/Hello-World',
  'https://github.com/octocat/Hello-World.git',
  'git@github.com:octocat/Hello-World.git',
  'ssh://git@github.com/octocat/Hello-World.git',
  'octocat/Hello-World',
]) assert.deepEqual(parseGitHubRepository(remote), {
  owner: 'octocat', repo: 'Hello-World', url: 'https://github.com/octocat/Hello-World',
});

for (const remote of [
  'https://github.com/octocat',
  'https://github.com/octocat/Hello-World/issues',
  'https://github.com/octocat/Hello-World?token=secret',
  'https://user:secret@github.com/octocat/Hello-World',
  'https://github.com.evil.test/octocat/Hello-World',
  'https://gitlab.com/octocat/Hello-World',
  'javascript:alert(1)',
]) assert.equal(parseGitHubRepository(remote), null);

console.log('GitHub repository URL test passed');
