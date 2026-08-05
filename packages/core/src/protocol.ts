import { z } from 'zod'

export const MediaTypeSchema = z.enum(['manga', 'anime', 'novel', 'movie', 'series'])
export const MediaStatusSchema = z.enum(['ongoing', 'completed', 'hiatus', 'cancelled'])
export const LibraryStatusSchema = z.enum(['reading', 'plan', 'completed', 'dropped', 'paused'])

export const MediaSchema = z.object({
  id: z.string(),
  title: z.string(),
  altTitles: z.array(z.string()).optional(),
  type: MediaTypeSchema,
  status: MediaStatusSchema.optional(),
  coverUrl: z.string().optional(),
  synopsis: z.string().optional(),
  tags: z.array(z.string()).optional(),
  mediaId: z.string(),
  sourceId: z.string()
})

export const EpisodeSchema = z.object({
  id: z.string(),
  number: z.number(),
  season: z.number().optional(),
  title: z.string().optional(),
  publishedAt: z.string().optional(),
  imageUrl: z.string().optional(),
  mediaId: z.string()
})

export const ChapterContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pages'), images: z.array(z.string()) }),
  z.object({ type: z.literal('text'), html: z.string() })
])

export const StreamSourceSchema = z.object({
  url: z.string(),
  kind: z.enum(['hls', 'mp4']),
  quality: z.string().optional(),
  headers: z.record(z.string()).optional()
})

export const SearchResultsSchema = z.object({
  page: z.number(),
  hasNextPage: z.boolean(),
  items: z.array(MediaSchema)
})

export const HistoryEntrySchema = z.object({
  media: MediaSchema,
  episode: EpisodeSchema,
  openedAt: z.number()
})

export const SourcePrefSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['boolean', 'select', 'string']),
  defaultValue: z.union([z.string(), z.boolean()]).optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  description: z.string().optional()
})

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string(),
  version: z.string(),
  apiVersion: z.number(),
  lang: z.string().optional(),
  nsfw: z.boolean().optional(),
  description: z.string().optional(),
  mediaTypes: z.array(MediaTypeSchema),
  entry: z.string(),
  sourceIds: z.array(z.string()),
  prefs: z.array(SourcePrefSchema).optional()
})

export const StreamSourceSchemaArray = z.array(StreamSourceSchema)
