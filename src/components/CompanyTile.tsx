import { useState } from 'react';
import { safeImageSrc } from '@/lib/safe-url';
import { hueFor, initialFor } from '@/lib/format';

interface Props {
  readonly id: string;
  readonly name: string;
  readonly logoUrl: string | null;
  readonly size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: 'w-[30px] h-[30px] rounded-[8px] text-[13px]',
  md: 'w-[32px] h-[32px] rounded-[8px] text-[14px]',
  lg: 'w-[52px] h-[52px] rounded-[12px] text-[22px]',
} as const;

/**
 * Company avatar: the company's logo when we hold one, otherwise a
 * deterministic coloured tile bearing the initial, which is the prototype's
 * treatment and remains the fallback in every failure case.
 *
 * Logos are never fetched from company domains at render time. Doing so would
 * fire a request to every company on the directory page — 58 cross-origin
 * requests disclosing the visitor's IP to 58 companies, which is hard to
 * reconcile with a tool that promises it cannot see what you look at. Instead
 * the update script downloads each logo once and commits it, so `logoUrl` is a
 * root-relative `/logos/...` path served from this origin: same picture, no
 * third-party request, `img-src 'self'` intact.
 */
export function CompanyTile({ id, name, logoUrl, size = 'md' }: Props) {
  const [failed, setFailed] = useState(false);
  const src = safeImageSrc(logoUrl);
  const hue = hueFor(id);
  const showLogo = src !== null && !failed;

  return (
    <div
      className={`${SIZES[size]} flex-none flex items-center justify-center font-semibold overflow-hidden`}
      style={
        showLogo
          ? // A logo sits on a neutral mat, not the initial's random hue: these
            // are brand marks, and laying one over an arbitrary saturated
            // colour muddies both. Light rather than dark, because across the
            // fetched set the transparent logos are mostly dark marks drawn for
            // a light ground — twice as many of them disappear on a dark mat as
            // on a light one. Not pure white either: a few brands are white
            // marks on transparency, and a mat slightly off white keeps them
            // visible as a shape instead of erasing them.
            { background: 'oklch(0.88 0.004 255)', color: 'oklch(0.17 0.02 255)' }
          : { background: `oklch(0.76 0.11 ${hue})`, color: 'oklch(0.17 0.02 255)' }
      }
      aria-hidden="true"
    >
      {showLogo ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          // `contain`, not `cover`: these are icons and wordmarks of every
          // aspect ratio, and cropping one to fill a square cuts the middle out
          // of a wide logo. A wide logo letterboxes against the mat instead.
          // No inset, so the common case — a full-bleed square app icon — fills
          // the tile and is clipped by its rounded corners rather than sitting
          // inside a ring of mat.
          className="w-full h-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        initialFor(name)
      )}
    </div>
  );
}
