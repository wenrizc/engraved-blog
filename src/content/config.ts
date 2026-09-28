import { defineCollection, z } from 'astro:content';

const articles = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional().default(''),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false)
  })
});

const photos = defineCollection({
  type: 'content',
  schema: ({ image }) =>
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
      .refine((data) => Boolean(data.cover || data.gallery.length > 0), {
        message: '摄影作品至少需要一张封面或图库图片'
      })
});

export const collections = { articles, photos };
