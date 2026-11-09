import type {
  Action,
  FactoryV2Command,
  FactoryV2CommandReceipt,
  FactoryV2ItemDetails,
  FactoryV2IssueSearch,
  FactoryV2PlanDetails,
  FactoryV2Snapshot,
  WorkItem,
} from '../../../src/http/index.js';
export type CommandInput = FactoryV2Command extends infer C
  ? C extends FactoryV2Command
    ? Pick<C, 'kind' | 'payload'>
    : never
  : never;

export class FactoryClient {
  private etag: string | null = null;
  private pending = false;
  private uncertain: FactoryV2Command | null = null;
  private activeCommand: FactoryV2Command | null = null;
  constructor(private readonly request: typeof fetch = (input, init) => fetch(input, init)) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(`/api/v2${path}`, init);
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.detail ?? body.title ?? `Request failed (${response.status})`);
    return body;
  }
  async board(signal?: AbortSignal): Promise<FactoryV2Snapshot | null> {
    const response = await this.request('/api/v2/board', {
      signal,
      headers: this.etag ? { 'if-none-match': this.etag } : {},
    });
    if (response.status === 304) return null;
    if (!response.ok) throw new Error(`Board unavailable (${response.status})`);
    const board: FactoryV2Snapshot = await response.json();
    if (board.apiVersion !== 2) throw new Error('Unsupported factory API version');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    this.etag = response.headers.get('etag');
    return board;
  }
  details(item: Pick<WorkItem, 'id' | 'version'>, signal?: AbortSignal) {
    return this.json<FactoryV2ItemDetails>(`/items/${encodeURIComponent(item.id)}`, {
      signal,
      headers: { 'if-match': `"${item.version}"` },
    });
  }
  search(query: string, pageToken?: string, signal?: AbortSignal) {
    const params = new URLSearchParams({ q: query, limit: '20' });
    if (pageToken) params.set('pageToken', pageToken);
    return this.json<FactoryV2IssueSearch>(`/issues/search?${params}`, { signal });
  }
  plan(id: string, signal?: AbortSignal) {
    return this.json<FactoryV2PlanDetails>(`/plans/${encodeURIComponent(id)}`, { signal });
  }
  async receipt(id: string) {
    const receipt = await this.json<FactoryV2CommandReceipt>(`/commands/${encodeURIComponent(id)}`);
    if (this.activeCommand?.commandId === id) {
      this.uncertain = receipt.state === 'uncertain' ? this.activeCommand : null;
      if (receipt.state === 'succeeded' || receipt.state === 'rejected') this.activeCommand = null;
    }
    return receipt;
  }
  get uncertainCommand() {
    return this.uncertain;
  }
  async submit(action: Action, input: CommandInput) {
    if (this.pending) throw new Error('A command is pending');
    if (this.uncertain) throw new Error('Resolve the uncertain command before submitting another.');
    if (this.activeCommand) throw new Error('A command is pending. Observe its receipt first.');
    if (action.availability.state !== 'available')
      throw new Error('Action unavailable. Refresh the board.');
    if (action.kind !== input.kind) throw new Error('Action kind changed. Refresh the board.');
    if (action.availability.validUntil && Date.parse(action.availability.validUntil) <= Date.now())
      throw new Error('Action expired. Refresh the board.');
    const command = {
      ...input,
      commandId: commandId(),
      actionId: action.id,
      precondition: action.availability.precondition,
    };
    return this.send(command);
  }
  async retry() {
    if (this.pending) throw new Error('A command is pending');
    if (!this.uncertain) throw new Error('No uncertain command');
    return this.send(this.uncertain);
  }
  async reconcile() {
    if (!this.uncertain) throw new Error('No uncertain command');
    const receipt = await this.receipt(this.uncertain.commandId);
    if (receipt.state !== 'uncertain') this.uncertain = null;
    return receipt;
  }
  private async send(command: FactoryV2Command) {
    this.pending = true;
    this.activeCommand = command;
    try {
      const response = await this.request('/api/v2/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status >= 500 || !['refresh', 'later', 'never'].includes(result.retry))
          this.uncertain = command;
        else {
          this.activeCommand = null;
          this.uncertain = null;
        }
        throw new Error(result.detail ?? result.title ?? 'Command rejected');
      }
      const receipt: FactoryV2CommandReceipt = result;
      this.uncertain = receipt.state === 'uncertain' ? command : null;
      if (receipt.state === 'succeeded' || receipt.state === 'rejected') this.activeCommand = null;
      return receipt;
    } catch (error) {
      if (error instanceof TypeError || error instanceof SyntaxError) {
        this.uncertain = command;
        throw new Error(
          'Command outcome uncertain. Observe its receipt or retry the same command.'
        );
      }
      throw error;
    } finally {
      this.pending = false;
    }
  }
}

/** getRandomValues remains available on private HTTP origins where randomUUID is absent. */
function commandId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
