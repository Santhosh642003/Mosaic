import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn, copyToClipboard } from '@/lib/utils';

interface RoomCodeDisplayProps {
  code: string;
  size?: 'sm' | 'md' | 'lg';
  showCopy?: boolean;
  className?: string;
}

export function RoomCodeDisplay({ code, size = 'md', showCopy = true, className }: RoomCodeDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const digitSize = {
    sm: 'w-7 h-9 text-sm',
    md: 'w-9 h-11 text-base',
    lg: 'w-12 h-14 text-xl',
  }[size];

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex gap-1.5">
        {code.split('').map((char, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center justify-center rounded border border-ms-border bg-ms-raised',
              'font-mono font-bold text-ms-fg tracking-widest',
              digitSize
            )}
          >
            {char}
          </div>
        ))}
      </div>
      {showCopy && (
        <button
          onClick={handleCopy}
          title="Copy room code"
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-semibold transition-colors',
            copied
              ? 'border-ms-green/30 bg-ms-green/10 text-ms-green'
              : 'border-ms-border bg-ms-raised text-ms-fg2 hover:text-ms-fg hover:bg-ms-border'
          )}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}

interface RoomCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  className?: string;
}

export function RoomCodeInput({ value, onChange, error, className }: RoomCodeInputProps) {
  const digits = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const padded = digits.padEnd(6, '');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const char = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1);
    const arr = padded.split('');
    arr[idx] = char;
    onChange(arr.join('').trimEnd());
    if (char && idx < 5) {
      const next = document.getElementById(`code-digit-${idx + 1}`);
      (next as HTMLInputElement | null)?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Backspace' && !padded[idx] && idx > 0) {
      const prev = document.getElementById(`code-digit-${idx - 1}`);
      (prev as HTMLInputElement | null)?.focus();
    }
    if (e.key === 'ArrowLeft' && idx > 0) {
      const prev = document.getElementById(`code-digit-${idx - 1}`);
      (prev as HTMLInputElement | null)?.focus();
    }
    if (e.key === 'ArrowRight' && idx < 5) {
      const next = document.getElementById(`code-digit-${idx + 1}`);
      (next as HTMLInputElement | null)?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    onChange(pasted);
    e.preventDefault();
    const last = document.getElementById(`code-digit-${Math.min(pasted.length, 5)}`);
    (last as HTMLInputElement | null)?.focus();
  };

  return (
    <div className={cn('flex gap-2', className)}>
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          id={`code-digit-${i}`}
          type="text"
          inputMode="text"
          maxLength={1}
          value={padded[i] ?? ''}
          onChange={(e) => handleChange(e, i)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          onPaste={handlePaste}
          className={cn(
            'w-10 h-12 text-center rounded border font-mono font-bold text-lg text-ms-fg bg-ms-raised',
            'focus:outline-none focus:ring-2 focus:border-ms-blue transition-colors uppercase',
            error
              ? 'border-ms-red focus:ring-ms-red'
              : 'border-ms-border focus:ring-ms-blue'
          )}
        />
      ))}
    </div>
  );
}
