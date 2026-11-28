import { useState } from 'react';
import { attachmentUrl } from '../../api.ts';
import { isPicture, type MessageFile } from '../../conversation.ts';
import { t } from '../../i18n/i18n.ts';
import { extensionOf, shownFileName, sizeLabel } from '../../intake-files.ts';
import { Dialog } from '../../kit/pop/Dialog.tsx';

// The files a message came with: an image shows as a thumbnail that opens large, anything else as
// a chip that downloads.
export function Attachments({ files }: { files: readonly MessageFile[] }) {
  const [open, setOpen] = useState<MessageFile | null>(null);
  // The picture stays while the dialog leaves, so it never shows empty on its way out.
  const [last, setLast] = useState<MessageFile | null>(null);
  if (files.length === 0) return null;
  const shown = open ?? last;
  return (
    <div className="hb-files">
      {files.map((file) =>
        isPicture(file) ? (
          <button
            key={file.id}
            type="button"
            className="hb-pic"
            aria-label={t('hablar.picture', { name: file.name })}
            onClick={() => {
              setOpen(file);
              setLast(file);
            }}
          >
            <img src={attachmentUrl(file.id)} alt={file.name} loading="lazy" />
          </button>
        ) : (
          <a
            key={file.id}
            className="hb-file"
            href={attachmentUrl(file.id)}
            download={file.name}
            aria-label={t('hablar.file', { name: file.name })}
          >
            <span className="hb-ext" aria-hidden="true">
              {extensionOf(file.name) || '·'}
            </span>
            <span className="hb-nm">{shownFileName(file.name)}</span>
            <span className="hb-sz">{sizeLabel(file.size)}</span>
          </a>
        ),
      )}
      <Dialog
        open={open !== null}
        label={shown?.name ?? t('hablar.picture', { name: '' })}
        size="lg"
        className="hb-big"
        onClose={() => setOpen(null)}
      >
        {shown ? <img src={attachmentUrl(shown.id)} alt={shown.name} data-i /> : null}
        {/* Always in sight, and where the focus starts: Tab stays between it and the picture. */}
        <button type="button" className="btn quiet hb-big-x" data-i onClick={() => setOpen(null)}>
          {t('common.close')}
        </button>
      </Dialog>
    </div>
  );
}
