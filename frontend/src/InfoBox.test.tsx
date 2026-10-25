import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Hint, InfoBox } from './InfoBox';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('custom help', () => {
    it.each([
        { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', touches: 5 },
        { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', platform: 'iPad', touches: 5 },
        { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', touches: 5 },
    ])('disables action hints and keeps Info help tap-only on $platform', async ({ userAgent, platform, touches }) => {
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
        vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
        vi.stubGlobal('navigator', Object.create(navigator, { maxTouchPoints: { value: touches } }));
        let clicks = 0;
        render(
            <>
                <Hint text="Edit this site">
                    <button onClick={() => clicks++}>Edit</button>
                </Hint>
                <InfoBox heading="Groups">Group help</InfoBox>
                <button>Outside</button>
            </>
        );
        const action = screen.getByRole('button', { name: 'Edit' });
        await userEvent.hover(action);
        fireEvent.focus(action);
        await userEvent.click(action);
        expect(clicks).toBe(1);
        expect(screen.queryByRole('tooltip')).toBeNull();
        expect(document.getElementById(action.getAttribute('aria-describedby')!)?.textContent).toBe('Edit this site');
        const info = screen.getByRole('button', { name: 'Groups information' });
        await userEvent.hover(info);
        fireEvent.focus(info);
        expect(screen.queryByRole('tooltip')).toBeNull();
        await userEvent.click(info);
        expect(screen.getByRole('tooltip').textContent).toContain('Group help');
        await userEvent.click(screen.getByRole('button', { name: 'Outside' }));
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('opens only from the info button and supports focus, tap and dismissal', async () => {
        render(
            <div>
                <span>Setting</span>
                <InfoBox heading="Groups">Group help</InfoBox>
                <button>Outside</button>
            </div>
        );
        expect(screen.queryByRole('tooltip')).toBeNull();
        const trigger = screen.getByRole('button', { name: 'Groups information' });
        expect(document.getElementById(trigger.getAttribute('aria-describedby')!)?.textContent).toContain('Group help');
        fireEvent.pointerEnter(screen.getByText('Setting'));
        expect(screen.queryByRole('tooltip')).toBeNull();
        fireEvent.pointerEnter(trigger);
        expect(screen.getByRole('tooltip').textContent).toContain('Group help');
        fireEvent.pointerEnter(screen.getByRole('tooltip'));
        await userEvent.keyboard('{Escape}');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        await userEvent.click(trigger);
        expect(screen.getByRole('tooltip')).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Outside' }));
        expect(screen.queryByRole('tooltip')).toBeNull();
        trigger.focus();
        await screen.findByRole('tooltip');
        await userEvent.tab();
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('preserves action handlers and uses the containing modal portal', async () => {
        let clicks = 0;
        render(
            <dialog open>
                <Hint text="Edit this site">
                    <button onClick={() => clicks++}>Edit</button>
                </Hint>
            </dialog>
        );
        const trigger = screen.getByRole('button', { name: 'Edit' });
        await userEvent.hover(trigger);
        expect(screen.getByRole('tooltip').closest('dialog')).toBeTruthy();
        await userEvent.click(trigger);
        expect(clicks).toBe(1);
        expect(screen.queryByRole('tooltip')).toBeNull();
        expect(document.querySelector('[title]')).toBeNull();
    });
});
