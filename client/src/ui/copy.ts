// Copy a text to the clipboard: the Clipboard API where the browser allows it (a secure
// page, the permission), else the old way through a hidden text area. Resolves to whether
// it worked, and never throws.

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // not allowed here (no permission, not a secure page): try the fallback
  }
  try {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    before?.focus();
    return ok;
  } catch {
    return false;
  }
}
