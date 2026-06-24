import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { MosaicLogo } from '@/components/shared/MosaicLogo';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-ms-base flex flex-col items-center justify-center p-6 text-center">
      <MosaicLogo size="lg" className="justify-center mb-12" />
      <div className="text-8xl font-black text-ms-fg3/20 mb-6 select-none">404</div>
      <h1 className="text-2xl font-extrabold tracking-tight mb-2">This page got merged away</h1>
      <p className="text-ms-fg3 mb-8 max-w-sm">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Button asChild>
        <Link to="/"><Home size={15} /> Back to home</Link>
      </Button>
    </div>
  );
}
