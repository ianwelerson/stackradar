import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="border-t border-line-faint px-5 py-5 flex flex-col gap-1.5 text-center font-mono text-[11px] text-ink-ghost">
      <div className="">
        Stack Radar · every listing links to the company&rsquo;s own careers
        page ·{" "}
        {/* Points at the methodology page rather than straight at the JSON: the
          file is linked from there, alongside what it contains and how it was
          gathered, which is what someone clicking "open data" actually wants. */}
        <Link
          to="/data"
          className="text-accent-link hover:text-accent-link-hover no-underline"
        >
          sources &amp; method
        </Link>
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
