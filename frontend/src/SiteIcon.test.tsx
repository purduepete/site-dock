import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SiteIcon } from './SiteIcon';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('tries site favicon formats directly without a referrer and falls back to circular initials', () => {
  const { container } = render(<SiteIcon url="https://example.com/path" name="Example Site" />);
  const image = container.querySelector('img')!;
  expect(image.getAttribute('src')).toBe('https://example.com/favicon.svg');
  expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
  fireEvent.error(image);
  expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/favicon.ico');
  for (let index = 0; index < 3; index++) fireEvent.error(container.querySelector('img')!);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('.site-monogram')?.textContent).toBe('ES');
});

it('uses circular initials without making mixed-content image requests', () => {
  vi.stubGlobal('location', { protocol: 'https:' });
  const { container } = render(<SiteIcon url="http://example.com/" name="Ferry Tracker" />);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('.site-monogram')?.textContent).toBe('FT');
});
