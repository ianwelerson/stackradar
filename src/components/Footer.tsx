export function Footer() {
  return (
    <footer className="border-t border-line-faint px-5 py-5 text-center font-mono text-[11px] text-ink-ghost">
      Stack Radar · every listing links to the company&rsquo;s own careers page ·{' '}
      {/* The whole dataset as one static file. The filtered HTTP API is built but
          not currently deployed, so this points at the data itself. */}
      <a
        href="/companies.json"
        className="text-accent-link hover:text-accent-link-hover no-underline"
      >
        open data
      </a>
    </footer>
  );
}
