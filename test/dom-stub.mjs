// A stand-in DOM for running the injected footer runtime and the sidebar page script in node:vm.
// It has no parser and no layout. An element that was given markup, or that belongs to a page,
// answers every descendant selector with one lasting stand-in element; lists are always empty.
// Each element counts the DOM writes made to it, which is what the repaint tests assert on.
export function createStubDom({ page = false } = {}) {
  const dom = { writes: 0, now: Date.now(), footers: [], tick: null };
  const attached = new Map();
  // Underscore properties are the scripts' own bookkeeping, not DOM writes.
  const counted = target => new Proxy(target, {
    set(object, key, value) { if (String(key)[0] !== '_') dom.writes++; object[key] = value; return true; },
    deleteProperty(object, key) { dom.writes++; return delete object[key]; },
  });

  function element(tagName = 'div', inTree = false) {
    const found = new Map();
    const attributes = new Map();
    const classes = new Set();
    let parent = null;
    let rootNode = null;
    const standIn = key => found.get(key) ?? found.set(key, element('div', true)).get(key);
    const target = {
      tagName: tagName.toUpperCase(), children: [], shadowRoot: null,
      id: '', textContent: '', innerHTML: '', hidden: false,
      _rect: { left: 0, top: 0, right: 240, bottom: 24, width: 240, height: 24 },
      style: counted({
        setProperty(name, value) { this[name] = String(value); },
        getPropertyValue(name) { return this[name] ?? ''; },
        removeProperty(name) { delete this[name]; },
      }),
      dataset: counted({}),
      classList: {
        contains: name => classes.has(name),
        add(...names) { for (const name of names) this.toggle(name, true); },
        remove(...names) { for (const name of names) this.toggle(name, false); },
        toggle(name, force = !classes.has(name)) {
          if (force !== classes.has(name)) { dom.writes++; if (force) classes.add(name); else classes.delete(name); }
          return force;
        },
      },
      hasAttribute: name => attributes.has(name),
      getAttribute: name => attributes.get(name) ?? null,
      setAttribute(name, value) { dom.writes++; attributes.set(name, String(value)); },
      removeAttribute(name) { dom.writes++; attributes.delete(name); },
      toggleAttribute(name, force) {
        const next = force === undefined ? !attributes.has(name) : Boolean(force);
        if (next !== attributes.has(name)) {
          dom.writes++;
          if (next) attributes.set(name, '');
          else attributes.delete(name);
        }
        return next;
      },
      matches: () => false,
      querySelector(selector) {
        const testId = /\[data-testid="([^"]+)"\]/.exec(selector)?.[1];
        if (testId) {
          const stack = [...target.children];
          while (stack.length) {
            const child = stack.shift();
            if (child.getAttribute('data-testid') === testId) return child;
            stack.push(...child.children);
          }
        }
        return (inTree || el.innerHTML) && !selector.includes(':hover') ? standIn(selector) : null;
      },
      querySelectorAll: () => [],
      closest(selector) {
        const specs = selector.split(',').map(s => s.trim()).filter(Boolean);
        for (let n = el; n; n = n.parentElement) {
          for (const part of specs) {
            const mVal = /^\[([^=\]]+)="([^"]*)"\]$/.exec(part);
            if (mVal && n.getAttribute(mVal[1]) === mVal[2]) return n;
            const mAttr = /^\[([^=\]]+)\]$/.exec(part);
            if (mAttr && n.hasAttribute(mAttr[1])) return n;
            const mCls = /^\.([^\s.[]+)$/.exec(part);
            if (mCls && n.classList.contains(mCls[1])) return n;
          }
        }
        return inTree ? standIn('closest ' + selector) : null;
      },
      contains(node) { for (let n = node; n; n = n.parentElement) if (n === el) return true; return false; },
      appendChild(child) {
        child.remove();
        dom.writes++;
        target.children.push(child);
        child._setParent(el);
        if (child.id) attached.set(child.id, child);
        return child;
      },
      prepend(...nodes) {
        for (const node of [...nodes].reverse()) {
          if (!node || typeof node !== 'object') { dom.writes++; continue; }
          node.remove();
          dom.writes++;
          target.children.unshift(node);
          node._setParent(el);
          if (node.id) attached.set(node.id, node);
        }
      },
      append(...nodes) {
        for (const node of nodes) {
          if (node && typeof node === 'object') this.appendChild(node);
          else dom.writes++;
        }
      },
      replaceChildren(...nodes) {
        for (const child of [...target.children]) child.remove();
        dom.writes++;
        this.append(...nodes);
      },
      insertAdjacentHTML() { dom.writes++; },
      remove() {
        if (!parent) return;
        dom.writes++;
        parent.children.splice(parent.children.indexOf(el), 1);
        if (attached.get(el.id) === el) attached.delete(el.id);
        parent = null;
      },
      attachShadow() {
        const shadow = {
          host: el, children: [],
          getElementById: id => shadow.children.find(child => child.id === id) ?? null,
          appendChild(child) { shadow.children.push(child); child._setRoot(shadow); return child; },
        };
        target.shadowRoot = shadow;
        return shadow;
      },
      getRootNode: () => rootNode ?? dom.document,
      getBoundingClientRect: () => ({ ...el._rect }),
      checkVisibility: () => true,
      addEventListener() {}, removeEventListener() {},
      _setParent(node) { parent = node; },
      _setRoot(node) { rootNode = node; },
    };
    Object.defineProperty(target, 'parentElement', { get: () => parent });
    Object.defineProperty(target, 'isConnected', { get: () => Boolean(parent || rootNode || inTree) });
    const el = counted(target);
    return el;
  }

  const body = element('body', page);
  dom.element = element;
  dom.document = {
    documentElement: element('html'), head: element('head'), body,
    createElement: tagName => element(tagName),
    getElementById: id => (page ? body.querySelector('#' + id) : attached.get(id) ?? null),
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => (!page && String(selector || '').includes('agy-composer-footer') ? dom.footers : []),
    addEventListener() {}, removeEventListener() {},
  };
  // The page globals the scripts read. Timers are captured so a test drives each tick itself.
  dom.globals = {
    document: dom.document, navigator: { language: 'en', languages: ['en'] }, location: { pathname: '/', search: '' },
    innerWidth: 1280, innerHeight: 800, scrollY: 0, scrollTo() {}, addEventListener() {}, removeEventListener() {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', overflowX: 'visible', contain: 'none' }),
    matchMedia: () => ({ matches: true }), // prefers-reduced-motion: nothing animates
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    SVGElement: class {},
    Date: class extends Date { static now() { return dom.now; } },
    setInterval(callback) { dom.tick = callback; return 1; }, clearInterval() {},
    setTimeout() { return 1; }, clearTimeout() {},
    console, URLSearchParams, AbortSignal,
  };
  return dom;
}
