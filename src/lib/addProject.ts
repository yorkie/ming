import { rememberProject, type Project } from './projectStore';

export async function addLocalProject(projects: Project[]): Promise<Project> {
  if (!('showDirectoryPicker' in window)) throw new Error('This browser does not support folder selection. Use a browser with the File System Access API over HTTPS or localhost.');
  const directory = await window.showDirectoryPicker({ mode: 'read' });
  const { validateGitRepository } = await import('./localRepository');
  await validateGitRepository(directory);
  for (const existing of projects) if (await existing.directory.isSameEntry(directory)) return existing;
  const project: Project = { id: crypto.randomUUID(), name: directory.name, directory, addedAt: Date.now(), settings: { baseRef: 'HEAD', liveReview: false, liveTopics: false } };
  await rememberProject(project);
  return project;
}
