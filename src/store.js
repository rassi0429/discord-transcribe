import { EventEmitter } from 'node:events';

export class Store extends EventEmitter {
  constructor() {
    super();
    this.rows = new Map();
    this.status = { mode: 'live', connected: false, channel: null, speakers: [], message: 'Discordで /caption start を実行してください' };
  }
  snapshot() { return { rows: [...this.rows.values()].sort((a, b) => a.startedAt - b.startedAt), status: this.status }; }
  updateStatus(patch) { Object.assign(this.status, patch); this.emit('change', { type: 'status', status: this.status }); }
  upsert(row) {
    const value = { ...this.rows.get(row.id), ...row };
    this.rows.set(row.id, value);
    while (this.rows.size > 200) this.rows.delete(this.rows.keys().next().value);
    this.emit('change', { type: 'row', row: value });
    return value;
  }
  patch(id, patch) { if (this.rows.has(id)) this.upsert({ id, ...patch }); }
  clear() { this.rows.clear(); this.emit('change', { type: 'reset' }); }
}
