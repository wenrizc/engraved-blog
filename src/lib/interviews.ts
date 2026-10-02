import { getCollection, type CollectionEntry } from 'astro:content';

export type InterviewEntry = CollectionEntry<'interviews'>;

export async function getInterviews() {
  return (await getCollection('interviews', ({ data }) => !data.draft)).sort((a, b) =>
    a.id.localeCompare(b.id, 'zh-CN')
  );
}

export function interviewUrl(slug: string) {
  return `/interview/article/${slug.split('/').map(encodeURIComponent).join('/')}/`;
}

export function interviewTopicUrl(tag: string) {
  return `/interview/topics/${encodeURIComponent(tag)}/`;
}

export interface InterviewDirectory {
  name: string;
  directories: InterviewDirectory[];
  entries: InterviewEntry[];
}

export function interviewTree(entries: InterviewEntry[]): InterviewDirectory {
  const root: InterviewDirectory = { name: '', directories: [], entries: [] };
  for (const entry of entries) {
    let directory = root;
    for (const name of entry.id.split('/').slice(0, -1)) {
      let child = directory.directories.find((item) => item.name === name);
      if (!child) {
        child = { name, directories: [], entries: [] };
        directory.directories.push(child);
      }
      directory = child;
    }
    directory.entries.push(entry);
  }
  return root;
}
