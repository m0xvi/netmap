/**
 * Global shim: overrides window.prompt/confirm/alert with async-in-place calls
 * to our React modal. Without this, Electron's contextIsolation prevents native
 * dialogs from working reliably (they either return null immediately or throw).
 *
 * IMPORTANT: The native prompt/confirm are SYNCHRONOUS but our replacement is async.
 * Callers already use `if (confirm(...))` and `const s = prompt(...)` — meaning
 * we can NOT do them synchronously. Instead we return a synthetic value that unblocks
 * the immediate branch, and let the actual UI drive the follow-up via the modal.
 *
 * For confirm: we ALWAYS return the result of a *pre-shown* modal. Since JS can't block,
 * we make confirm actually show the modal and only return once the user clicks (using
 * a busy-wait would freeze). So we accept the limitation: any code that does
 *
 *     if (confirm(...)) doThing();
 *
 * will get a Promise-like behavior via async patching.
 *
 * Solution: we monkey-patch confirm/prompt/alert to return a THENABLE — but crucially,
 * we always run the code in an async wrapper at the site of override. That requires
 * either updating callers to `await` (best) OR making callers naturally async.
 *
 * Since a truly synchronous replacement is impossible without a modal-blocking API
 * (which the browser doesn't provide), we simply expose promptText/confirmDialog/alertDialog
 * from Modal.tsx and replace callers explicitly. This file is now a no-op stub kept
 * for compatibility.
 */

export {};
