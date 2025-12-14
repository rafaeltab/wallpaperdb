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
