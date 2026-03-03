import { cn } from '../lib/utils';
import { motion } from 'framer-motion';

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  isResizing: boolean;
  onDoubleClick?: () => void;
  className?: string;
}

export function ResizeHandle({ onMouseDown, isResizing, onDoubleClick, className }: ResizeHandleProps) {
  return (
    <div
      className={cn(
        "w-3 cursor-col-resize transition-colors relative group flex items-stretch justify-center",
        isResizing && "bg-primary/10",
        className
      )}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    >
      <motion.div
        whileHover={{ scaleY: 1.05, width: '2px' }}
        className={cn(
          "w-px my-2 rounded-full bg-border/80 group-hover:bg-primary/50 transition-all duration-200",
          isResizing && "bg-primary w-[2px]"
        )}
      />
      <div className="absolute inset-y-0 left-0 right-0" />
    </div>
  );
}
