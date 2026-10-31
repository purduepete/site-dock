// iPhone, iPod and iPad, including iPads that report a desktop Mac identity.
export function isAppleTouchDevice() {
    return (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
}
