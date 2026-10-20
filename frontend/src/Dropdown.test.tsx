import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Dropdown } from './Dropdown';

afterEach(cleanup);
function Fixture() {
    const [value, setValue] = useState('system');
    return (
        <>
            <Dropdown
                label="Theme"
                value={value}
                onChange={setValue}
                options={[
                    { value: 'system', label: 'System' },
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' },
                ]}
            />
            <button>Outside</button>
        </>
    );
}

describe('custom dropdown', () => {
    it('selects an option and returns focus to the trigger', async () => {
        render(<Fixture />);
        const trigger = screen.getByRole('combobox', { name: 'Theme' });
        await userEvent.click(trigger);
        expect(screen.getByRole('option', { name: 'System' }).getAttribute('aria-selected')).toBe('true');
        await userEvent.click(screen.getByRole('option', { name: 'Dark' }));
        expect(trigger.textContent).toBe('Dark');
        expect(document.activeElement).toBe(trigger);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.querySelector('select')).toBeNull();
    });
    it('supports arrow keys, Home, End, Enter, Escape, and outside dismissal', async () => {
        render(<Fixture />);
        const trigger = screen.getByRole('combobox', { name: 'Theme' });
        trigger.focus();
        await userEvent.keyboard('{ArrowDown}{End}{Enter}');
        expect(trigger.textContent).toBe('Light');
        await userEvent.keyboard('{ArrowUp}{Home}{Enter}');
        expect(trigger.textContent).toBe('System');
        await userEvent.click(trigger);
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('listbox')).toBeNull();
        await userEvent.click(trigger);
        await userEvent.click(screen.getByRole('button', { name: 'Outside' }));
        expect(screen.queryByRole('listbox')).toBeNull();
    });
});
