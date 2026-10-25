import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Hint, InfoBox } from './InfoBox';

afterEach(cleanup);

describe('custom help', () => {
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
