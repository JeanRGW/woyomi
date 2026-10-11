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
  coverHeaders: z.record(z.string()).optional(),
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
  lang: z.string().optional(),
  mediaId: z.string()
})

export const ChapterContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pages'), images: z.array(z.string()), headers: z.record(z.string()).optional() }),
  z.object({ type: z.literal('text'), html: z.string() })
])

export const StreamSourceSchema = z.object({
  url: z.string(),
  kind: z.enum(['hls', 'mp4', 'dash']),
  quality: z.string().optional(),
  audio: z.string().optional(),
  headers: z.record(z.string()).optional()
})

/** Shape of the native fetch_url command's response, validated at the IPC boundary. */
export const FetchResultSchema = z.object({
  status: z.number(),
  headers: z.record(z.string()),
  body: z.string()
})

export const SearchResultsSchema = z.object({
  page: z.number(),
  hasNextPage: z.boolean(),
  items: z.array(MediaSchema)
})

export const HomeSectionSchema = z.object({
  id: z.string(),
  title: z.string()
})

export const HistoryEntrySchema = z.object({
  media: MediaSchema,
  episode: EpisodeSchema,
  openedAt: z.number()
})

export const LibraryEntrySchema = z.object({
  media: MediaSchema,
  status: LibraryStatusSchema,
  addedAt: z.number(),
  updatedAt: z.number().optional()
})

export const ProgressEntrySchema = z.object({
  mediaId: z.string(),
  seenEpisodeIds: z.array(z.string()),
  updatedAt: z.number()
})

export const SyncTombstoneSchema = z.object({ id: z.string(), deletedAt: z.number() })

export const SyncEditsSchema = z.object({
  entries: z.array(SyncTombstoneSchema).default([]),
  progress: z.array(SyncTombstoneSchema).default([]),
  history: z.array(SyncTombstoneSchema).default([])
})

/**
 * Shape of the library payload exchanged with the sync server and backup
 * files. Missing collections default to empty and `version` to 1 so older
 * payloads stay loadable; unknown fields are stripped.
 */
export const SyncPayloadSchema = z.object({
  version: z.number().default(1),
  entries: z.array(LibraryEntrySchema).default([]),
  progress: z.array(ProgressEntrySchema).default([]),
  history: z.array(HistoryEntrySchema).default([]),
  tombstones: SyncEditsSchema.default({ entries: [], progress: [], history: [] })
})

export const SourcePrefSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    type: z.enum(['boolean', 'select', 'string', 'multi']),
    defaultValue: z.union([z.string(), z.boolean(), z.array(z.string())]).optional(),
    options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    description: z.string().optional()
  })
  .superRefine((pref, ctx) => {
    if (pref.defaultValue === undefined) return
    const isArray = Array.isArray(pref.defaultValue)
    if ((pref.type === 'multi') !== isArray) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `defaultValue for '${pref.type}' pref must be ${pref.type === 'multi' ? 'an array' : 'a scalar'}`
      })
    }
  })

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string(),
  version: z.string(),
  apiVersion: z.number(),
  lang: z.union([z.string(), z.array(z.string())]).optional(),
  nsfw: z.boolean().optional(),
  description: z.string().optional(),
  mediaTypes: z.array(MediaTypeSchema),
  entry: z.string(),
  sourceIds: z.array(z.string()),
  prefs: z.array(SourcePrefSchema).optional()
})

export const StreamSourceSchemaArray = z.array(StreamSourceSchema)
