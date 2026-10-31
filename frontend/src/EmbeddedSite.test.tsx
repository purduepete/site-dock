import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbeddedSite } from './EmbeddedSite';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const props = () => ({
    identity: 'example:https://example.invalid/',
    url: 'https://example.invalid/',
    label: 'Example',
    active: true,
    revealedSites: new Set<string>(),
    frameRef: () => {},
});

describe('embedded first visits', () => {
    it('reveals on the readiness fallback without a spinner or claiming a load', async () => {
        const inputs = props();
        const view = render(<EmbeddedSite {...inputs} />);
        const frame = screen.getByTitle('Example');
        await act(() => vi.advanceTimersByTimeAsync(250));
        expect(screen.queryByRole('status')).toBeNull();
        expect(frame.classList.contains('ready')).toBe(false);
        await act(() => vi.advanceTimersByTimeAsync(3750));
        expect(screen.queryByRole('status')).toBeNull();
        expect(frame.classList.contains('ready')).toBe(true);
        expect(frame.classList.contains('loaded')).toBe(false);
        expect(frame.classList.contains('first-reveal')).toBe(true);
        view.rerender(<EmbeddedSite {...inputs} active={false} />);
        view.rerender(<EmbeddedSite {...inputs} />);
        expect(screen.getByTitle('Example')).toBe(frame);
        const classes = frame.className;
        fireEvent.load(frame);
        expect(frame.classList.contains('loaded')).toBe(true);
        expect(frame.className.replace(' loaded', '')).toBe(classes);
    });

    it('reveals on load and suppresses first-visit feedback after a version replacement', async () => {
        const inputs = props();
        const view = render(<EmbeddedSite key="v0" {...inputs} />);
        await act(() => vi.advanceTimersByTimeAsync(300));
        fireEvent.load(screen.getByTitle('Example'));
        expect(screen.getByTitle('Example').classList.contains('first-reveal')).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        view.rerender(<EmbeddedSite key="v1" {...inputs} />);
        await act(() => vi.advanceTimersByTimeAsync(300));
        expect(screen.getByTitle('Example').classList.contains('ready')).toBe(false);
        await act(() => vi.advanceTimersByTimeAsync(3700));
        expect(screen.getByTitle('Example').classList.contains('ready')).toBe(true);
        expect(screen.getByTitle('Example').classList.contains('first-reveal')).toBe(false);
    });

    it('cancels inactive fallback timers and restarts them on return', async () => {
        const inputs = props();
        const view = render(<EmbeddedSite {...inputs} />);
        await act(() => vi.advanceTimersByTimeAsync(300));
        view.rerender(<EmbeddedSite {...inputs} active={false} />);
        await act(() => vi.advanceTimersByTimeAsync(4000));
        expect(screen.getByTitle('Example').classList.contains('ready')).toBe(false);
        view.rerender(<EmbeddedSite {...inputs} />);
        await act(() => vi.advanceTimersByTimeAsync(3999));
        expect(screen.getByTitle('Example').classList.contains('ready')).toBe(false);
        await act(() => vi.advanceTimersByTimeAsync(1));
        expect(screen.getByTitle('Example').classList.contains('ready')).toBe(true);
        view.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps the first reveal when reloading before it happens', async () => {
        const inputs = props();
        const view = render(<EmbeddedSite key="v0" {...inputs} />);
        await act(() => vi.advanceTimersByTimeAsync(100));
        view.rerender(<EmbeddedSite key="v1" {...inputs} />);
        await act(() => vi.advanceTimersByTimeAsync(250));
        fireEvent.load(screen.getByTitle('Example'));
        expect(screen.getByTitle('Example').classList.contains('first-reveal')).toBe(true);
    });

    it('never shows a spinner when switching between two pending frames', async () => {
        const first = props();
        const second = { ...props(), identity: 'other', label: 'Other' };
        const contents = (active: boolean) => (
            <>
                <EmbeddedSite {...first} active={active} />
                <EmbeddedSite {...second} active={!active} />
            </>
        );
        const view = render(contents(true));
        await act(() => vi.advanceTimersByTimeAsync(300));
        view.rerender(contents(false));
        await act(() => vi.advanceTimersByTimeAsync(300));
        expect(screen.queryByRole('status')).toBeNull();
        fireEvent.load(screen.getByTitle('Other'));
        expect(screen.getByTitle('Other').classList.contains('first-reveal')).toBe(true);
        view.rerender(<EmbeddedSite key="replacement" {...second} revealedSites={second.revealedSites} />);
        fireEvent.load(screen.getByTitle('Other'));
        expect(screen.getByTitle('Other').classList.contains('first-reveal')).toBe(false);
    });
});
