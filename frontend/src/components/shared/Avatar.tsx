import { cn, initials, avatarColor } from '@/lib/utils';
import type { MemberStatus } from '@/types';

interface AvatarProps {
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  status?: MemberStatus;
  className?: string;
  color?: string;
}

const STATUS_RING: Record<MemberStatus, string> = {
  coding:  'bg-ms-green',
  done:    'bg-ms-purple',
  blocked: 'bg-ms-amber',
  waiting: 'bg-ms-fg3',
};

const SIZE_MAP = {
  xs: { outer: 'w-5 h-5',  text: 'text-[8px]',  ring: 'w-2 h-2 -bottom-0.5 -right-0.5 border' },
  sm: { outer: 'w-7 h-7',  text: 'text-[10px]', ring: 'w-2.5 h-2.5 -bottom-0.5 -right-0.5 border' },
  md: { outer: 'w-9 h-9',  text: 'text-xs',     ring: 'w-3 h-3 -bottom-0.5 -right-0.5 border-[1.5px]' },
  lg: { outer: 'w-12 h-12', text: 'text-sm',    ring: 'w-3.5 h-3.5 -bottom-0.5 -right-0.5 border-2' },
};

export function Avatar({ name, size = 'md', status, className, color }: AvatarProps) {
  const bg = color ?? avatarColor(name);
  const sizes = SIZE_MAP[size];

  return (
    <div className={cn('relative flex-none', className)}>
      <div
        className={cn(
          'rounded-full flex items-center justify-center font-semibold text-white select-none',
          sizes.outer,
          sizes.text
        )}
        style={{ background: bg }}
        title={name}
      >
        {initials(name)}
      </div>
      {status && (
        <span
          className={cn(
            'absolute rounded-full border-ms-base',
            sizes.ring,
            STATUS_RING[status]
          )}
        />
      )}
    </div>
  );
}
