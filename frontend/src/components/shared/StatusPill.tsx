import { cn } from '@/lib/utils';
import type { MemberStatus } from '@/types';

interface StatusPillProps {
  status: MemberStatus;
  name?: string;
  className?: string;
}

const STATUS_CONFIG: Record<MemberStatus, { dot: string; label: string; pill: string }> = {
  coding:  { dot: 'bg-ms-green animate-ms-pulse',  label: 'Coding',  pill: 'text-ms-green border-ms-green/30 bg-ms-green/10' },
  done:    { dot: 'bg-ms-purple',                   label: 'Done',    pill: 'text-ms-purple border-ms-purple/30 bg-ms-purple/10' },
  blocked: { dot: 'bg-ms-amber animate-ms-pulse',   label: 'Blocked', pill: 'text-ms-amber border-ms-amber/30 bg-ms-amber/10' },
  waiting: { dot: 'bg-ms-fg3',                      label: 'Waiting', pill: 'text-ms-fg3 border-ms-border bg-ms-raised' },
};

export function StatusPill({ status, name, className }: StatusPillProps) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-semibold',
        cfg.pill,
        className
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full flex-none', cfg.dot)} />
      {name ? `${name} · ${cfg.label}` : cfg.label}
    </span>
  );
}

export function StatusDot({ status, className }: { status: MemberStatus; className?: string }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={cn('w-2 h-2 rounded-full flex-none', cfg.dot, className)} />
  );
}
