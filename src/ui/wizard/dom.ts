// Tiny DOM builder. Text is always set via textContent, never innerHTML,
// so file names and other library data can't inject markup.

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'class') {
        el.className = String(value);
      } else if (key === 'text') {
        el.textContent = String(value);
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

/** Paragraph with **bold** segments, built safely. */
export function rich(tag: 'p' | 'div' | 'span' | 'li', text: string, cls?: string): HTMLElement {
  const el = h(tag, cls ? { class: cls } : null);
  text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (part.startsWith('**') && part.endsWith('**')) el.appendChild(h('strong', null, part.slice(2, -2)));
    else if (part) el.appendChild(document.createTextNode(part));
  });
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function openInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener');
}
