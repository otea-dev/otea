import { t } from '../../i18n/i18n.ts';
import { Icon } from '../../kit/index.ts';
import { noticeIdOf, type ReviewNotice } from './review-notices.ts';

// What the person should know before Aprobar, said beside it in plain words (review-notices.ts): the
// attached diff is not what lands (the warn outline, with the technical sentences folded one tap
// away) and what the assistant or the delivering agent advised (the neutral outline: advice, never a
// block). Drawn the same on the desk's page, the phone's page and the Triage card.
export function ReviewNotices({
  item,
  notices,
  className,
}: {
  item: string;
  notices: readonly ReviewNotice[];
  className?: string;
}) {
  if (notices.length === 0) return null;
  return (
    <div className={className ? `rvn ${className}` : 'rvn'} data-c>
      {notices.map((notice) => (
        <div
          key={notice.key}
          id={noticeIdOf(item, notice.key)}
          className={notice.key === 'diff' ? 'bstrip drift' : 'bstrip note'}
          data-notice={notice.key}
          data-kind={notice.kind}
          role="status"
        >
          <Icon name={notice.key === 'diff' ? 'warn' : 'note'} />
          <span>{notice.text}</span>
          {notice.detail.length > 0 ? (
            <details>
              <summary>{t('tech.title')}</summary>
              {notice.detail.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
}
