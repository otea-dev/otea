import type { ReactNode } from 'react';
import { t } from '../../i18n/i18n.ts';

// What only someone who reads code can use (the branch, the diff, the test output, the files that
// two changes share, what Otea checked), folded behind «Detalles técnicos» so a review leads with
// what changed in plain words and the pictures. Closed unless the person opens it; never removed.
export function TechDetails({
  notices = 0,
  children,
}: {
  // How many warnings wait inside: said on the summary, so a closed fold does not hide a problem.
  notices?: number | undefined;
  children: ReactNode;
}) {
  return (
    <details className="tech" data-c>
      <summary>
        <span>{t('tech.title')}</span>
        {notices > 0 ? <small>{t('tech.notices', { count: notices })}</small> : null}
      </summary>
      <div className="tech-body">{children}</div>
    </details>
  );
}
