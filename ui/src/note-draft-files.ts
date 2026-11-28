// The files of a quick note that is not sent yet, kept on the phone per project so the page can
// reload (the installed app updating itself while the camera, another app, has the front) and bring
// them back with the words (note-draft.ts). IndexedDB takes bytes; a File picked lives only in the
// open page. A database of its own: the capture queue's (offline/idb-queue.ts) is shared with the
// service worker and never changes under it.

const DB = 'otea-note-draft';
const STORE = 'files';

type Kept = {
  id: string;
  files: { name: string; type: string; lastModified: number; bytes: ArrayBuffer }[];
};

const keyOf = (project: string | undefined) => project ?? '';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = act(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// Keeps exactly these files for the project; none forgets them. Never throws: a phone with no
// IndexedDB (a private window) simply loses them on a reload, as before.
export async function keepNoteFiles(
  project: string | undefined,
  files: readonly File[],
): Promise<void> {
  try {
    if (files.length === 0) {
      await run('readwrite', (store) => store.delete(keyOf(project)));
      return;
    }
    const kept: Kept = {
      id: keyOf(project),
      files: await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
          bytes: await file.arrayBuffer(),
        })),
      ),
    };
    await run('readwrite', (store) => store.put(kept));
  } catch {
    // nowhere to keep them
  }
}

export async function readNoteFiles(project: string | undefined): Promise<File[]> {
  try {
    const kept = await run<Kept | undefined>('readonly', (store) => store.get(keyOf(project)));
    return (kept?.files ?? []).map(
      ({ name, type, lastModified, bytes }) => new File([bytes], name, { type, lastModified }),
    );
  } catch {
    return [];
  }
}
