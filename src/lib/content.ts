import { getCollection, type CollectionEntry } from 'astro:content';

export type ArticleEntry = CollectionEntry<'articles'>;
export type PhotoEntry = CollectionEntry<'photos'>;

export async function getPublishedArticles(): Promise<ArticleEntry[]> {
  const posts = await getCollection('articles', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export async function getPhotos(): Promise<PhotoEntry[]> {
  const photos = await getCollection('photos', ({ data }) => !data.draft);
  return photos.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export async function getAllTags(): Promise<string[]> {
  const articles = await getPublishedArticles();
  const photos = await getPhotos();
  return uniqueSorted([
    ...articles.flatMap((entry) => entry.data.tags),
    ...photos.flatMap((entry) => entry.data.tags)
  ]);
}

export async function getEntriesByTag(tag: string) {
  const articles = await getPublishedArticles();
  const photos = await getPhotos();
  return {
    articles: articles.filter((entry) => entry.data.tags.includes(tag)),
    photos: photos.filter((entry) => entry.data.tags.includes(tag))
  };
}

export function articleUrl(slug: string) {
  return `/article/${slug}/`;
}

export function photoUrl(slug: string) {
  return `/photography/${slug}/`;
}

export function tagUrl(tag: string) {
  return `/tags/${encodeURIComponent(tag)}/`;
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
