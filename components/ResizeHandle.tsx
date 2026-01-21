import { cn } from '../lib/utils';

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  isResizing: boolean;
}

export function ResizeHandle({ onMouseDown, isResizing }: ResizeHandleProps) {
  return (
    <div
      className={cn(
        "w-3 cursor-col-resize transition-colors relative group flex items-stretch justify-center",
        isResizing && "bg-primary/10"
      )}
      onMouseDown={onMouseDown}
    >
      <div
        className={cn(
          "w-px my-2 rounded-full bg-border/80 group-hover:bg-primary/50 transition-colors",
          isResizing && "bg-primary"
        )}
      />
      <div className="absolute inset-y-0 left-0 right-0" />
    </div>
  );
}
