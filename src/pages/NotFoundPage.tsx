import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="max-w-[640px] mx-auto px-5 py-20 text-center flex flex-col items-center gap-4">
      <div className="font-mono text-[11px] text-ink-faint uppercase tracking-[0.07em]">404</div>
      <h1 className="text-[22px] font-semibold m-0">Nothing here</h1>
      <p className="text-ink-dim text-[13.5px] text-pretty m-0">
        That page doesn&rsquo;t exist. The company may have been removed from the index, or the
        link may be out of date.
      </p>
      <Link
        to="/"
        className="bg-accent text-accent-ink rounded-[7px] px-[15px] py-[9px] text-[12.5px] font-medium no-underline hover:bg-accent-hover transition-colors"
      >
        Browse companies
      </Link>
    </main>
  );
}
