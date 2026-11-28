// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../i18n/i18n.ts';
import { type Mounted, mount, settle } from '../../test-dom.tsx';
import type { Evidence } from '../../types.ts';
import { ImageSingle } from './ImageViews.tsx';

// Field study s-real (D-6c1648): the photo the person sent showed as a broken-image icon with its
// file name in the item's review, after the connection had been cut for a moment. The file is whole
// (it opened a minute later); the browser asks once, and an image that failed stays failed. The
// review says what happened and offers the way back, and the way comes by itself with the network.

const photo: Evidence = {
  id: 10,
  itemId: 'CAM-3',
  role: 'single',
  module: null,
  kind: 'image',
  filename: 'lapicera-olivo.png',
  contentType: 'image/png',
  size: 22177,
  sha256: 'a'.repeat(64),
  caption: null,
  createdAt: '2026-11-28T11:23:19.684Z',
  actor: { kind: 'human', name: 'human' },
  channel: 'ui',
};

let page: Mounted | undefined;
beforeEach(() => setLanguage('es'));
afterEach(() => {
  page?.unmount();
  page = undefined;
  setLanguage('en');
});

const fail = async (img: Element | null) => {
  await act(async () => {
    img?.dispatchEvent(new Event('error'));
  });
  await settle();
};

describe('a picture that did not load', () => {
  it('says which file it is, and offers to try again, instead of a broken icon', async () => {
    page = mount(<ImageSingle evidence={photo} />);
    await settle();
    await fail(page.root.querySelector('img'));

    expect(page.root.querySelector('img')).toBeNull();
    expect(page.root.textContent).toContain('lapicera-olivo.png');
    expect(page.root.textContent).toMatch(/no se pudo cargar/i);
    expect(page.root.querySelector('.ev-broken button')).not.toBeNull();
  });

  it('asks for the file again when the person does, and shows it when it comes', async () => {
    page = mount(<ImageSingle evidence={photo} />);
    await settle();
    const first = page.root.querySelector('img')?.getAttribute('src');
    await fail(page.root.querySelector('img'));

    const retry = page.root.querySelector('.ev-broken button') as HTMLElement;
    await act(async () => retry.click());
    await settle();
    const again = page.root.querySelector('img');
    expect(again).not.toBeNull();
    expect(again?.getAttribute('src')).not.toBe(first);
    expect(page.root.querySelector('.ev-broken')).toBeNull();
  });

  it('asks again by itself when the connection is back', async () => {
    page = mount(<ImageSingle evidence={photo} />);
    await settle();
    await fail(page.root.querySelector('img'));
    expect(page.root.querySelector('img')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await settle();
    expect(page.root.querySelector('img')).not.toBeNull();
  });
});
