type IconName =
    'plus' | 'external' | 'reload' | 'edit' | 'trash' | 'up' | 'down' | 'menu' | 'close' | 'logout' | 'hide' | 'show';
const paths: Record<IconName, string> = {
    plus: 'M12 5v14M5 12h14',
    external: 'M14 3h7v7M21 3l-10 10M10 3H3v18h18v-7',
    reload: 'M20 7v5h-5M20 12a8 8 0 1 0-2 6M20 7l-3-3',
    edit: 'm15 4 5 5M3 21l5-1L21 7l-5-5L3 15v6Z',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    up: 'm6 15 6-6 6 6',
    down: 'm6 9 6 6 6-6',
    menu: 'M4 6h16M4 12h16M4 18h16',
    close: 'm6 6 12 12M6 18 18 6',
    logout: 'M10 4H3v16h7M8 12h13m-5-5 5 5-5 5',
    hide: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.7 10.7 0 0 1 12 5c5 0 8.3 4.5 9 7-.3 1.1-1 2.2-1.8 3.2M6.6 6.6C4.5 7.8 3.4 9.8 3 12c.5 2.5 3.8 7 9 7 1.3 0 2.4-.3 3.4-.8',
    show: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Zm7-0a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z',
};
export function Icon({ name }: { name: IconName }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={paths[name]} />
        </svg>
    );
}
