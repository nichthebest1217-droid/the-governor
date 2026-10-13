import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

export const SECTION_SLUGS = ['news', 'opinion', 'arts', 'sports', 'humor-fun', 'people', 'school-culture'] as const;

// Dates stay strings ("2026-05-14" or a full ISO timestamp with offset) so that the calendar
// day an editor typed is the day readers see, whatever timezone the build machine is in.
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/, 'Use YYYY-MM-DD');
const optionalText = z.string().trim().min(1).nullish().or(z.literal('').transform(() => null));
const fileId = ({ entry }: { entry: string }) => entry.replace(/\.[^.]+$/, '');

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles', generateId: fileId }),
  schema: z.object({
    title: z.string().min(1),
    publishedAt: dateString,
    updatedAt: dateString.nullish(),
    section: z.enum(SECTION_SLUGS),
    secondarySections: z.array(z.enum(SECTION_SLUGS)).nullish().transform((v) => v ?? []),
    kind: z.enum(['article', 'editorial']).default('article'),
    tags: z.array(z.string()).nullish().transform((v) => v ?? []),
    authors: z.array(z.string()).nullish().transform((v) => v ?? []),
    originalByline: optionalText,
    excerpt: optionalText,
    coverImage: optionalText,
    coverAlt: optionalText,
    coverCaption: optionalText,
    coverCredit: optionalText,
    featured: z.boolean().default(false),
    // Anything not explicitly published stays off the site, the feeds and the search index.
    published: z.boolean().default(false),
    issueId: optionalText,
    correction: optionalText,
    // Position in the print edition (page, then order on the front-to-back read). Optional.
    printPage: z.number().int().nullish(),
    printOrder: z.number().nullish(),
    legacyWpId: z.number().int().nullish(),
    legacyUrl: z.url().nullish(),
    legacyPath: z.string().regex(/^\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/$/).nullish(),
    sourceModifiedAt: dateString.nullish(),
    authorNeedsReview: z.boolean().default(false),
    migrationNeedsReview: z.boolean().default(false),
  }),
});

const authors = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/authors', generateId: fileId }),
  schema: z.object({
    slug: z.string(),
    name: z.string().min(1),
    classYear: z.number().int().min(1900).max(2100).nullish(),
    bio: optionalText,
    photo: optionalText,
    visible: z.boolean().default(true),
    needsReview: z.boolean().default(false),
    sourceEvidence: optionalText,
  }),
});

const issues = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/issues', generateId: fileId }),
  schema: z.object({
    slug: z.string(),
    title: z.string().min(1),
    season: z.string().nullish(),
    year: z.number().int(),
    number: z.number().int().nullish(),
    volume: z.number().int().nullish(),
    dateLabel: optionalText,
    publishedOn: dateString.nullish(),
    academicYear: z.string().nullish(),
    pdf: optionalText,
    pdfBytes: z.number().nullish(),
    pageImages: z.array(z.string()).nullish().transform((v) => v ?? []),
    notes: z.array(z.string()).nullish().transform((v) => v ?? []),
    sourceEvidence: z.array(z.string()).nullish().transform((v) => v ?? []),
  }),
});

export const collections = { articles, authors, issues };
