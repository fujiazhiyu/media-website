export const GESTURE = Object.freeze({ pixelsPerSecond: 12, threshold: 24, maxSeconds: 60, edgeGuard: 24, doubleTapMs: 320, tapSlop: 10 });
export const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
export function horizontalGesture(dx, dy) { return Math.abs(dx) > GESTURE.threshold && Math.abs(dx) > Math.abs(dy) * 1.35; }
export function gestureSeek(start, dx, duration) { return clamp(start + clamp(dx / GESTURE.pixelsPerSecond, -GESTURE.maxSeconds, GESTURE.maxSeconds), 0, Math.max(0, duration || 0)); }
export function tapZone(x, width) { return x < width * .32 ? 'left' : x > width * .68 ? 'right' : 'center'; }
export function resumePosition(saved, duration) { return Number.isFinite(saved) && saved > 3 && duration > 0 && saved < duration - 10 && saved / duration < .97 ? saved : 0; }
