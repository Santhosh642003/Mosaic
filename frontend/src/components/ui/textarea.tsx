import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-ms-fg2 uppercase tracking-wider">
            {label}
          </label>
        )}
        <textarea
          id={inputId}
          ref={ref}
          className={cn(
            'w-full rounded-md border bg-ms-raised px-3 py-2 text-sm text-ms-fg placeholder:text-ms-fg3',
            'focus:outline-none focus:ring-2 focus:ring-ms-blue focus:border-ms-blue',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'resize-y min-h-[80px] transition-colors',
            error
              ? 'border-ms-red focus:ring-ms-red'
              : 'border-ms-border',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-ms-red">{error}</p>}
        {hint && !error && <p className="text-xs text-ms-fg3">{hint}</p>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
