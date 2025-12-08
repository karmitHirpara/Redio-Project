import { Folder, Lock, Unlock, Edit2, Trash2, Calendar, Clock } from 'lucide-react';
import { Playlist } from '../types';
import { cn } from '../lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './ui/context-menu';
import { motion } from 'motion/react';

interface PlaylistFolderProps {
  playlist: Playlist;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
  onToggleLock: () => void;
  onSchedule: () => void;
  onDuplicate: () => void;
  scheduleLabel?: string;
}

export function PlaylistFolder({
  playlist,
  onClick,
  onRename,
  onDelete,
  onToggleLock,
  onSchedule,
  onDuplicate,
  scheduleLabel,
}: PlaylistFolderProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <motion.div
          whileHover={{ scale: 1.02 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors",
            "hover:bg-accent/50"
          )}
          onClick={onClick}
        >
          <Folder className="w-4 h-4 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-sm text-foreground truncate">{playlist.name}</span>
              {playlist.locked && <Lock className="w-3 h-3 text-muted-foreground" />}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{playlist.tracks.length} trk</span>
              <span>•</span>
              <span>{Math.round(playlist.duration / 60)} min</span>
              {scheduleLabel && (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span className="truncate max-w-[110px]">{scheduleLabel}</span>
                  </span>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onClick}>
          Open
        </ContextMenuItem>
        <ContextMenuItem onClick={onDuplicate}>
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem onClick={onRename} disabled={playlist.locked}>
          <Edit2 className="w-3 h-3 mr-2" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={onToggleLock}>
          {playlist.locked ? (
            <>
              <Unlock className="w-3 h-3 mr-2" />
              Unlock
            </>
          ) : (
            <>
              <Lock className="w-3 h-3 mr-2" />
              Lock
            </>
          )}
        </ContextMenuItem>
        <ContextMenuItem onClick={onDelete} className="text-destructive" disabled={playlist.locked}>
          <Trash2 className="w-3 h-3 mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}