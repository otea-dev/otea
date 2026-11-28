import { useEffect, useState } from 'react';
import { attachmentUrl } from '../../api.ts';
import { fileViewOf } from '../../components/evidence/file-view.ts';
import { isPicture, type MessageFile } from '../../conversation.ts';
import { t } from '../../i18n/i18n.ts';
import { extensionOf, shownFileName, sizeLabel } from '../../intake-files.ts';
import { Dialog } from '../../kit/pop/Dialog.tsx';
import { renderMarkdown } from '../../markdown.ts';

// A text file is read whole only up to this size; a larger one is only downloaded.
const MAX_READ_BYTES = 512 * 1024;

const isMarkdown = (file: MessageFile): boolean =>
  fileViewOf({ filename: file.name, contentType: file.contentType }) === 'markdown' &&
  file.size <= MAX_READ_BYTES;

// The words of a Markdown file the secretary sent (a release note, steps to try something), once
// read; `failed` when it cannot be, and the download is still there.
function useFileText(file: MessageFile | null): string | 'loading' | 'failed' {
  const [state, setState] = useState<string | 'loading' | 'failed'>('loading');
  const id = file?.id;
  useEffect(() => {
    if (id === undefined) return;
    setState('loading');
    const controller = new AbortController();
    fetch(attachmentUrl(id), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`GET failed with ${response.status}`);
        return response.text();
      })
      .then(setState, () => {
        if (!controller.signal.aborted) setState('failed');
      });
    return () => controller.abort();
  }, [id]);
  return state;
}

function Chip({ file, onOpen }: { file: MessageFile; onOpen?: () => void }) {
  const body = (
    <>
      <span className="hb-ext" aria-hidden="true">
        {extensionOf(file.name) || '·'}
      </span>
      <span className="hb-nm">{shownFileName(file.name)}</span>
      <span className="hb-sz">{sizeLabel(file.size)}</span>
    </>
  );
  // A file the page can read opens in a reader; any other is the download itself.
  return onOpen ? (
    <button
      type="button"
      className="hb-file"
      aria-label={t('hablar.fileRead', { name: file.name })}
      onClick={onOpen}
    >
      {body}
    </button>
  ) : (
    <a
      className="hb-file"
      href={attachmentUrl(file.id)}
      download={file.name}
      aria-label={t('hablar.file', { name: file.name })}
    >
      {body}
    </a>
  );
}

// The files a message came with: an image shows as a thumbnail that opens large, a Markdown file as
// a chip that opens formatted, anything else as a chip that downloads.
export function Attachments({ files }: { files: readonly MessageFile[] }) {
  const [open, setOpen] = useState<MessageFile | null>(null);
  // The file stays while the dialog leaves, so it never shows empty on its way out.
  const [last, setLast] = useState<MessageFile | null>(null);
  const shown = open ?? last;
  const text = useFileText(shown !== null && isMarkdown(shown) ? shown : null);
  if (files.length === 0) return null;
  const show = (file: MessageFile) => {
    setOpen(file);
    setLast(file);
  };
  const reading = shown !== null && isMarkdown(shown);
  return (
    <div className="hb-files">
      {files.map((file) =>
        isPicture(file) ? (
          <button
            key={file.id}
            type="button"
            className="hb-pic"
            aria-label={t('hablar.picture', { name: file.name })}
            onClick={() => show(file)}
          >
            <img src={attachmentUrl(file.id)} alt={file.name} loading="lazy" />
          </button>
        ) : (
          <Chip
            key={file.id}
            file={file}
            {...(isMarkdown(file) ? { onOpen: () => show(file) } : {})}
          />
        ),
      )}
      <Dialog
        open={open !== null}
        label={shown?.name ?? t('hablar.picture', { name: '' })}
        size="lg"
        className="hb-big"
        onClose={() => setOpen(null)}
      >
        {shown && !reading ? <img src={attachmentUrl(shown.id)} alt={shown.name} data-i /> : null}
        {shown && reading ? (
          text === 'loading' || text === 'failed' ? (
            <p className="t-cap" aria-busy={text === 'loading'}>
              {t(text === 'loading' ? 'evidence.loading' : 'evidence.unreadable')}
            </p>
          ) : (
            <div
              className="md hb-read"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes raw HTML and drops dangerous links
              dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
            />
          )
        ) : null}
        {/* Always in sight, and where the focus starts: Tab stays between it and the file. */}
        <div className="hb-big-bar">
          <button type="button" className="btn quiet hb-big-x" data-i onClick={() => setOpen(null)}>
            {t('common.close')}
          </button>
          {shown && reading ? (
            <a className="btn quiet" href={attachmentUrl(shown.id)} download={shown.name} data-i>
              {t('evidence.download')}
            </a>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
