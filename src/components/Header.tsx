import { Link, useNavigate } from 'react-router-dom';
import { useTracking } from '@/hooks/useTracking';

interface Props {
  readonly indexLine: string;
  readonly onOpenStorage: () => void;
}

export function Header({ indexLine, onOpenStorage }: Props) {
  const { connected, trackedIds } = useTracking();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-20 bg-header backdrop-blur-[12px] border-b border-line">
      <div className="max-w-[1180px] mx-auto px-5 py-[14px] flex items-center gap-4 flex-wrap">
        <Link
          to="/"
          className="flex items-center gap-[10px] mr-auto no-underline text-ink"
          aria-label="Stack Radar home"
        >
          <span className="w-[22px] h-[22px] rounded-[5px] bg-accent flex items-center justify-center flex-none">
            <span
              className="w-[7px] h-[7px] rounded-[1px]"
              style={{ background: 'oklch(0.18 0.02 162)' }}
            />
          </span>
          <span className="flex items-baseline gap-[9px]">
            <span className="font-semibold text-[15px] tracking-[-0.01em]">Stack&nbsp;Radar</span>
            <span className="font-mono text-[11px] text-ink-faint tracking-[0.02em] hidden sm:inline">
              who&rsquo;s hiring your stack
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-ink-fainter pr-1 hidden md:inline">
            {indexLine}
          </span>
          <button
            type="button"
            onClick={() => void navigate('/my-list')}
            className="bg-control border border-line-control text-ink-muted rounded-[7px] px-[11px] py-[7px] text-[12.5px] cursor-pointer whitespace-nowrap hover:border-accent-line-hover hover:text-ink transition-colors"
          >
            {trackedIds.length > 0 ? `My list · ${trackedIds.length}` : 'My list'}
          </button>
          <button
            type="button"
            onClick={onOpenStorage}
            className="flex items-center gap-[7px] bg-control border border-line-control text-ink-muted rounded-[7px] px-[11px] py-[7px] text-[12.5px] cursor-pointer hover:border-line-hover hover:text-ink transition-colors"
          >
            <span
              className="w-[6px] h-[6px] rounded-full flex-none"
              style={{
                background: connected
                  ? 'oklch(0.80 0.15 162)'
                  : 'var(--color-dot-unknown)',
              }}
            />
            <span className="hidden sm:inline">
              {connected ? 'Storage connected' : 'Connect storage'}
            </span>
            <span className="sm:hidden">{connected ? 'Synced' : 'Storage'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
