export function Footer() {
  return (
    <footer className="border-t border-line-faint px-5 py-5 flex flex-col gap-1.5 text-center font-mono text-[11px] text-ink-ghost">
      <div className="">
        Stack Radar · every listing links to the company&rsquo;s own careers
        page ·{" "}
        {/* The whole dataset as one static file. The filtered HTTP API is built but
          not currently deployed, so this points at the data itself. */}
        <a
          href="/companies.json"
          className="text-accent-link hover:text-accent-link-hover no-underline"
          target="_blank"
        >
          open data
        </a>
      </div>
      <a
        href="https://ianwelerson.com/"
        className="text-accent-link hover:text-accent-link-hover no-underline"
        target="_blank"
      >
        Create by Ian Welerson
      </a>
    </footer>
  );
}
