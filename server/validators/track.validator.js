import { z } from 'zod';

export const trackSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    artist: z.string().optional().default('Unknown Artist'),
    duration: z.number().nonnegative().optional().default(0),
});

export const trackEditSchema = z.object({
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
    mode: z.enum(['overwrite', 'duplicate']).optional().default('overwrite'),
    playlistContext: z.object({
        playlistId: z.string(),
        position: z.number().nonnegative(),
    }).optional().nullable(),
});

export const folderSchema = z.object({
    name: z.string().min(1, 'Folder name is required'),
    parentId: z.string().uuid().optional().nullable(),
});
