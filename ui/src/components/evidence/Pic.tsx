import { type ImgHTMLAttributes, useCallback, useEffect, useState } from 'react';
import { t } from '../../i18n/i18n.ts';

// A picture of the work, as the review draws it. The browser asks for a file once: when the
// connection was cut at that moment, the picture stayed a broken-image icon with its file name for as
// long as the page lived, though the file was whole (D-6c1648). Here it says so in words, offers to
// ask again, and asks again by itself when the connection returns.

export function Pic({
  src,
  name,
  opens,
  ...img
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  src: string;
  // The file's name, for the notice that stands where it did not load.
  name: string;
  // A picture that opens the file in a page of its own: the link wraps the picture, never the notice.
  opens?: string;
}) {
  const [failed, setFailed] = useState(false);
  // How many times it was asked for again: a new address, so the browser does not reuse the failure.
  const [tries, setTries] = useState(0);
  const again = useCallback(() => {
    setTries((n) => n + 1);
    setFailed(false);
  }, []);
  useEffect(() => {
    if (!failed) return undefined;
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [failed, again]);

  if (failed) {
    return (
      <div className="ev-broken">
        <span className="t-cap">{t('evidence.broken', { file: name })}</span>
        <button type="button" className="btn quiet sm" onClick={again}>
          {t('evidence.retry')}
        </button>
      </div>
    );
  }
  const at = tries === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}again=${tries}`;
  // biome-ignore lint/a11y/useAltText: the alt text arrives with the rest of the img props
  const picture = <img {...img} src={at} onError={() => setFailed(true)} />;
  return opens === undefined ? (
    picture
  ) : (
    <a href={opens} target="_blank" rel="noreferrer">
      {picture}
    </a>
  );
}
