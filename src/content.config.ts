import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const contentLoader = (name: string) =>
  glob({
    base: `./src/content/${name}`,
    pattern: '**/*.md',
    generateId: ({ entry }) => entry.replace(/\.md$/, '')
  });

const articles = defineCollection({
  loader: contentLoader('articles'),
  schema: z.object({
    title: z.string(),
    description: z.string().optional().default(''),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false)
  })
});

const photos = defineCollection({
  loader: contentLoader('photos'),
  schema: ({ image }) =>
    z.preprocess(
      (data) => {
        // Draft assets must not enter Astro's image imports or the public build.
        if (data && typeof data === 'object' && 'draft' in data && data.draft === true) {
          return { ...data, cover: undefined, gallery: [] };
        }
        return data;
      },
      z
        .object({
          title: z.string(),
          description: z.string().optional().default(''),
          date: z.coerce.date(),
          tags: z.array(z.string()).default([]),
          draft: z.boolean().default(false),
          cover: image().optional(),
          gallery: z
            .array(
              z.object({
                src: image(),
                caption: z.string().optional()
              })
            )
            .default([])
        })
        .refine((data) => data.draft || Boolean(data.cover || data.gallery.length > 0), {
          message: '摄影作品至少需要一张封面或图库图片'
        })
    )
});

const interviews = defineCollection({
  loader: contentLoader('interviews'),
  schema: z.object({
    title: z.string(),
    description: z.string().default(''),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false)
  })
});

export const collections = { articles, photos, interviews };
