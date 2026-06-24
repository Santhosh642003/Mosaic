import { cn } from '@/lib/utils';

interface MosaicLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

const TILE_COLORS = [
  '#4F8EF7', '#2D4A77', '#4F8EF7',
  '#2D4A77', '#4F8EF7', '#3FB950',
  '#4F8EF7', '#3FB950', '#2D4A77',
];

export function MosaicLogo({ size = 'md', showText = true, className }: MosaicLogoProps) {
  const tileSize = size === 'sm' ? 4 : size === 'lg' ? 8 : 6;
  const gap = size === 'sm' ? 1 : 2;
  const textSize = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-xl' : 'text-base';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="grid flex-none"
        style={{
          gridTemplateColumns: `repeat(3, ${tileSize}px)`,
          gridTemplateRows: `repeat(3, ${tileSize}px)`,
          gap: `${gap}px`,
        }}
      >
        {TILE_COLORS.map((color, i) => (
          <div key={i} style={{ background: color }} />
        ))}
      </div>
      {showText && (
        <span className={cn('font-bold text-ms-fg', textSize)}>Mosaic</span>
      )}
    </div>
  );
}
