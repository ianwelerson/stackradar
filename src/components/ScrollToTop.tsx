import { useEffect } from 'react';
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom';

/**
 * Put a new page at the top of itself.
 *
 * A single-page app keeps the scroll position across a route change, so opening
 * a company from halfway down the directory dropped you halfway down its page —
 * usually past the company's own name.
 *
 * Two deliberate exceptions:
 *
 * - **Back and forward are left alone.** On a POP the browser restores the
 *   position you left, and that is the whole point of going back: returning to
 *   the row you were looking at, not to the top of a list you have already read.
 * - **Only the pathname counts.** Filters live in the query string and change on
 *   every keystroke in the search box; scrolling on those would yank the page
 *   out from under someone mid-search.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === NavigationType.Pop) return;

    // Honour the same preference the stylesheet does for animations; a smooth
    // scroll is motion, and for some readers it is the nauseating kind.
    let behavior: ScrollBehavior = 'smooth';
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) behavior = 'auto';
    } catch {
      /* matchMedia unavailable — smooth is a safe default */
    }

    try {
      window.scrollTo({ top: 0, left: 0, behavior });
    } catch {
      // Older engines reject the options object; the two-argument form has no
      // smoothing but still gets the reader to the top, which is the point.
      window.scrollTo(0, 0);
    }
  }, [pathname, navigationType]);

  return null;
}
