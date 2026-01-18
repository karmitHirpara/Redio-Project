import { cn } from '../lib/utils';

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  isResizing: boolean;
}

export function ResizeHandle({ onMouseDown, isResizing }: ResizeHandleProps) {
  return (
    <div
      className={cn(
        "w-1 bg-border hover:bg-primary/50 cursor-col-resize transition-colors relative group",
        isResizing && "bg-primary"
      )}
      onMouseDown={onMouseDown}
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
