import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { cn } from '../../lib/utils';

interface StepperInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  showButtons?: boolean;
}

export function StepperInput({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  className,
  disabled = false,
  placeholder = '0',
  showButtons = true,
}: StepperInputProps) {
  const [inputValue, setInputValue] = useState(String(value));

  useEffect(() => {
    setInputValue(String(value));
  }, [value]);

  const handleIncrement = () => {
    const next = Math.min(max, value + step);
    onChange(next);
    setInputValue(String(next));
  };

  const handleDecrement = () => {
    const next = Math.max(min, value - step);
    onChange(next);
    setInputValue(String(next));
  };

  const commit = (raw: string) => {
    const trimmed = String(raw ?? '').trim();
    if (trimmed === '') {
      setInputValue(String(value));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setInputValue(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onChange(clamped);
    setInputValue(String(clamped));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleBlur = () => commit(inputValue);

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {showButtons ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleDecrement}
          disabled={disabled || value <= min}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      ) : null}
      <Input
        type="number"
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(inputValue);
          }
          if (e.key === 'Escape') {
            setInputValue(String(value));
          }
        }}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        className="w-16 h-7 text-center text-xs [appearance:textfield] focus:outline-none focus:ring-1 focus:ring-ring focus:ring-offset-0 bg-white text-black placeholder:text-black/40"
      />
      {showButtons ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleIncrement}
          disabled={disabled || value >= max}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
