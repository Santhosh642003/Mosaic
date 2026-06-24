import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border',
  {
    variants: {
      variant: {
        blue:   'bg-ms-blue/10 text-ms-blue border-ms-blue/30',
        green:  'bg-ms-green/10 text-ms-green border-ms-green/30',
        purple: 'bg-ms-purple/10 text-ms-purple border-ms-purple/30',
        amber:  'bg-ms-amber/10 text-ms-amber border-ms-amber/30',
        red:    'bg-ms-red/10 text-ms-red border-ms-red/30',
        muted:  'bg-ms-raised text-ms-fg3 border-ms-border',
      },
    },
    defaultVariants: { variant: 'muted' },
  }
);

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant, className, children }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)}>{children}</span>
  );
}
