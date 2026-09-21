/**
 * Emit a static HTML shell per company route.
 *
 * The app is a single-page build, so without this every URL would serve one
 * generic <head>. That is fine for people (React fills the page in) but not for
 * crawlers, link previews, or the AI research tools the project explicitly wants
 * to be discoverable by — they read the served HTML.
 *
 * Each generated file is the real app shell with company-specific metadata
 * injected, so the page still boots and hydrates normally.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

/** Escape for use inside a double-quoted HTML attribute. */
const attr = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const text = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const [shell, raw] = await Promise.all([
  readFile(resolve(dist, 'index.html'), 'utf8'),
  readFile(resolve(root, 'data/companies.json'), 'utf8'),
]);

const { companies } = JSON.parse(raw);

function describe(company) {
  const bits = [];
  if (company.currentOpenings.length > 0) {
    bits.push(
      `${company.currentOpenings.length} open role${company.currentOpenings.length === 1 ? '' : 's'}`,
    );
  }
  if (company.country !== null) bits.push(company.country);
  if (company.remotePolicy !== null) bits.push(company.remotePolicy);
  if (company.keywords.length > 0) bits.push(company.keywords.slice(0, 4).join(', '));
  // The description usually ends in a full stop already; don't chain a dash
  // onto it and produce "…audiences. — remote · …".
  const base = company.description.replace(/\s*[.·—-]+\s*$/, '');
  return bits.length > 0 ? `${base}. ${bits.join(' · ')}.` : `${base}.`;
}

/** Apply per-route metadata to the built shell. */
function render({ title, description, canonical }) {
  return shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${text(title)}</title>`)
    .replace(
      /<meta\s+name="description"[\s\S]*?\/>/,
      `<meta name="description" content="${attr(description)}" />`,
    )
    .replace(
      /<meta property="og:title"[^>]*\/>/,
      `<meta property="og:title" content="${attr(title)}" />\n    <link rel="canonical" href="${attr(canonical)}" />`,
    )
    .replace(
      /<meta property="og:description"[^>]*\/>/,
      `<meta property="og:description" content="${attr(description)}" />`,
    );
}

let written = 0;

// The methodology page is the one non-company route worth a real shell: it is
// what a reader lands on when they want to know whether to trust any of this,
// and it should carry its own title and description when shared or indexed.
{
  const target = resolve(dist, 'data.html');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    render({
      title: 'Where this data comes from — Stack Radar',
      description:
        'How Stack Radar gathers companies and open roles: the sources, why fields are left '
        + 'empty rather than guessed, what is deliberately not collected, and the full dataset '
        + 'as one JSON file.',
      canonical: '/data',
    }),
    'utf8',
  );
  written += 1;
}

for (const company of companies) {
  const title = `${company.name} — hiring on Stack Radar`;
  const description = describe(company);
  const canonical = `/company/${company.id}`;

  const html = render({ title, description, canonical });

  const target = resolve(dist, 'company', `${company.id}.html`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html, 'utf8');
  written += 1;
}

console.log(`prerendered ${written} pages (${written - 1} companies + /data)`);
