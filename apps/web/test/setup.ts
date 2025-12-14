import '@testing-library/jest-dom/vitest';

// Mock window.matchMedia for components that use it (e.g., theme detection)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver for components that use it
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock DataTransfer for drag and drop tests
class MockDataTransfer {
  _files: File[] = [];

  constructor() {
    const self = this;
    this.items = {
      add(file: File) {
        self._files.push(file);
        return { kind: 'file', type: file.type, getAsFile: () => file };
      },
      get length() {
        return self._files.length;
      },
    } as unknown as DataTransferItemList;
  }

  items: DataTransferItemList;

  get files(): FileList {
    const files = this._files;
    return {
      length: files.length,
      item: (index: number) => files[index] || null,
      [Symbol.iterator]: function* () {
        for (const file of files) {
          yield file;
        }
      },
    } as unknown as FileList;
  }

  setData(): void {}
  getData(): string {
    return '';
  }
}

global.DataTransfer = MockDataTransfer as unknown as typeof DataTransfer;

// Mock IntersectionObserver with controllable trigger for testing
type IntersectionCallback = (entries: IntersectionObserverEntry[]) => void;
const intersectionObserverCallbacks = new Set<{
  callback: IntersectionCallback;
  elements: Set<Element>;
}>();

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  private callback: IntersectionCallback;
  private elements = new Set<Element>();
  private registration: { callback: IntersectionCallback; elements: Set<Element> };

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback as IntersectionCallback;
    this.registration = { callback: this.callback, elements: this.elements };
    intersectionObserverCallbacks.add(this.registration);
  }

  observe(element: Element) {
    this.elements.add(element);
  }

  unobserve(element: Element) {
    this.elements.delete(element);
  }

  disconnect() {
    this.elements.clear();
    intersectionObserverCallbacks.delete(this.registration);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

// Test helper to trigger intersection on all observers
export function triggerIntersection(isIntersecting: boolean) {
  intersectionObserverCallbacks.forEach(({ callback, elements }) => {
    const entries = Array.from(elements).map((element) => ({
      target: element,
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRect: {} as DOMRectReadOnly,
      rootBounds: null,
      time: Date.now(),
    }));
    if (entries.length > 0) {
      callback(entries);
    }
  });
}

// Helper to clear all observer registrations between tests
export function clearIntersectionObservers() {
  intersectionObserverCallbacks.clear();
}
