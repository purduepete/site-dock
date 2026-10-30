import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoadingSpinner } from './LoadingSpinner';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('shared delayed spinner', () => {
    it('waits 250ms in StrictMode and disappears immediately even during its fade', async () => {
        vi.useFakeTimers();
        const view = render(
            <StrictMode>
                <LoadingSpinner isLoading label="Loading test" />
            </StrictMode>
        );
        await act(() => vi.advanceTimersByTimeAsync(249));
        expect(screen.queryByRole('status')).toBeNull();
        await act(() => vi.advanceTimersByTimeAsync(1));
        vi.useRealTimers();
        expect(await screen.findByRole('status', { name: 'Loading test' })).toBeTruthy();
        view.rerender(
            <StrictMode>
                <LoadingSpinner isLoading={false} label="Loading test" />
            </StrictMode>
        );
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('does not flash for fast loads and resets each loading period', async () => {
        vi.useFakeTimers();
        const view = render(<LoadingSpinner isLoading label="Loading test" small />);
        await act(() => vi.advanceTimersByTimeAsync(100));
        view.rerender(<LoadingSpinner isLoading={false} label="Loading test" small />);
        await act(() => vi.advanceTimersByTimeAsync(500));
        expect(screen.queryByRole('status')).toBeNull();
        view.rerender(<LoadingSpinner isLoading label="Loading test" small />);
        await act(() => vi.advanceTimersByTimeAsync(250));
        expect(screen.getByRole('status').querySelector('.loading-ring-small')).toBeTruthy();
        view.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
