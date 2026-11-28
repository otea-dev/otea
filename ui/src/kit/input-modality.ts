// A focus ring says where the keys are. After a tap or a click it says nothing the finger did not
// already: field study 7 saw a blue rectangle round the Hablar tab right after it was tapped (the
// page hands the focus on by itself when a control goes, and a browser may then take that for the
// keys). The document says which hand was last on it, and the stylesheet draws a ring only for
// the keys (base.css: `:root[data-input="pointer"]`). Nothing said yet counts as the keys: the
// first Tab of a page shows its ring.

export type Modality = 'key' | 'pointer';

// A modifier held on its own moves no focus.
const SILENT = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS']);

export function trackModality(doc: Document = document): () => void {
  const root = doc.documentElement;
  const say = (hand: Modality) => {
    if (root.getAttribute('data-input') !== hand) root.setAttribute('data-input', hand);
  };
  const onKey = (event: KeyboardEvent) => {
    if (!SILENT.has(event.key)) say('key');
  };
  const onPointer = () => say('pointer');
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onPointer, true);
  return () => {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onPointer, true);
    root.removeAttribute('data-input');
  };
}
