// In-memory stand-in for @supabase/supabase-js, served to the app by Playwright. TEST ONLY.
// It mimics just the calls the app makes. It does NOT verify Supabase itself (database rules are tested on real PostgreSQL).
const B = 'bbbbbbbb-0000-4000-8000-000000000001', F = 'ffffffff-0000-4000-8000-000000000002', M = 'eeeeeeee-0000-4000-8000-000000000003', C = 'cccccccc-0000-4000-8000-000000000009';
const Q = (n, f, a, m) => ({ id: `aaaaaaaa-0000-4000-8000-00000000000${n}`, category: 'daily_love', frequency: f, audience: a, message: m, is_active: true });

const S = (window.__SB = window.__SB || {
  users: { 'becam@test.local': { id: B, pw: 'good-pass', email: 'becam@test.local' }, 'faith@test.local': { id: F, pw: 'good-pass', email: 'faith@test.local' }, 'mallory@test.local': { id: M, pw: 'good-pass', email: 'mallory@test.local' } },
  session: null, listeners: [], handlers: [], dropAfterInsert: 0, calls: [], seq: 0,
  t: {
    couple_members: [{ couple_id: C, user_id: B, partner_role: 'becam' }, { couple_id: C, user_id: F, partner_role: 'faith' }],
    couple_settings: [{ id: 's1', couple_id: C, couple_name: 'Becam & Faith', departure_at: '2026-10-01T00:00:00Z', expected_return_at: '2028-10-01T00:00:00Z', actual_reunion_at: null, home_city: 'Nairobi, Kenya', destination_city: 'Manama, Bahrain', home_timezone: 'Africa/Nairobi', destination_timezone: 'Asia/Bahrain', home_lat: -1.2921, home_lon: 36.8219, destination_lat: 26.2235, destination_lon: 50.5876, daily_notification_enabled: true, default_notification_time: '08:00:00', custom_milestone_rules: [] }],
    profiles: [{ id: B, display_name: 'Becam', partner_role: 'becam', timezone: 'Africa/Nairobi' }, { id: F, display_name: 'Faith', partner_role: 'faith', timezone: 'Asia/Bahrain' }],
    quotes: [Q(1, 'daily', 'general', 'Fake daily quote one.'), Q(2, 'daily', 'general', 'Fake daily quote two.'), Q(3, 'weekly', 'general', 'Fake weekly quote.'), Q(4, 'monthly', 'general', 'Fake monthly quote.')],
    quote_favorites: [], milestones: [], special_dates: [], couple_photos: [], messages: [], notification_preferences: [], daily_quote_history: [], milestone_deliveries: [], notification_subscriptions: [],
  },
  deliver(row) { S.t.messages.push(row); S.handlers.forEach((h) => h({ eventType: 'INSERT', new: row })); },
  expire() { S.session = null; S.listeners.forEach((cb) => cb('SIGNED_OUT', null)); },
});

const offline = () => !navigator.onLine;
const netErr = () => ({ data: null, error: { message: 'Failed to fetch', status: 0 } });
const uniq = { messages: ['sender_id', 'client_id'], milestones: ['couple_id', 'milestone_date'] };

class Query {
  constructor(table) { this.table = table; this.op = 'select'; this.filters = []; this.sort = null; this.lim = null; this.payload = null; this.opts = {}; this.ret = false; this.single_ = null; }
  select() { if (this.op !== 'select') this.ret = true; return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  upsert(p, o = {}) { this.op = 'upsert'; this.payload = p; this.opts = o; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  order(c, { ascending = true } = {}) { this.sort = [c, ascending]; return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.single_ = 'single'; return this; }
  maybeSingle() { this.single_ = 'maybe'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    if (offline()) return netErr();
    const rows = S.t[this.table]; const me = S.session?.user.id;
    const visible = (r) => this.table !== 'messages' || r.sender_id === me || r.recipient_id === me;
    S.calls.push(`${this.op} ${this.table}`);
    let out = [];
    if (this.op === 'select') out = rows.filter((r) => visible(r) && this.filters.every((f) => f(r)));
    else if (this.op === 'insert' || this.op === 'upsert') {
      for (const p of [].concat(this.payload)) {
        const row = { id: `r${++S.seq}`, ...p };
        const keys = this.op === 'upsert' ? (this.opts.onConflict || '').split(',').filter(Boolean) : uniq[this.table] || [];
        const dup = keys.length && rows.find((r) => keys.every((k) => r[k] === row[k]));
        if (dup) {
          if (this.op === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          if (this.opts.ignoreDuplicates) continue;
          Object.assign(dup, p); out.push(dup); continue;
        }
        rows.push(row); out.push(row);
      }
      if (this.op === 'insert' && this.table === 'messages' && S.dropAfterInsert > 0) { S.dropAfterInsert--; return netErr(); } // server stored it, response lost
    } else if (this.op === 'update') {
      for (const r of rows) if (visible(r) && this.filters.every((f) => f(r))) { Object.assign(r, this.payload); out.push(r); }
    } else if (this.op === 'delete') {
      const keep = rows.filter((r) => !(this.filters.every((f) => f(r)))); out = rows.filter((r) => !keep.includes(r)); S.t[this.table] = keep;
    }
    if (this.sort) out = [...out].sort((a, b) => (a[this.sort[0]] > b[this.sort[0]] ? 1 : -1) * (this.sort[1] ? 1 : -1));
    if (this.lim) out = out.slice(0, this.lim);
    if (this.op !== 'select' && !this.ret) return { data: null, error: null };
    out = out.map((r) => ({ ...r }));
    if (this.single_) return { data: out[0] ?? null, error: out[0] || this.single_ === 'maybe' ? null : { message: 'no rows' } };
    return { data: out, error: null };
  }
}

export function createClient() {
  return {
    auth: {
      async getSession() { return { data: { session: S.session } }; },
      onAuthStateChange(cb) { S.listeners.push(cb); return { data: { subscription: {} } }; },
      async signInWithPassword({ email, password }) {
        if (offline()) return { data: null, error: { message: 'Failed to fetch' } };
        const u = S.users[email.toLowerCase()];
        if (!u || u.pw !== password) return { data: null, error: { message: 'Invalid login credentials' } };
        S.session = { user: { id: u.id, email: u.email } }; S.listeners.forEach((cb) => cb('SIGNED_IN', S.session));
        return { data: { user: S.session.user, session: S.session }, error: null };
      },
      async signOut() { S.session = null; return { error: null }; },
      async resetPasswordForEmail() { S.calls.push('reset'); return { error: null }; },
      async updateUser() { return { error: null }; },
    },
    from: (t) => new Query(t),
    channel() { const ch = { on(_t, _f, h) { S.handlers.push((p) => h(p)); return ch; }, subscribe() { return ch; } }; return ch; },
    removeChannel() {},
    storage: { from: () => ({ async upload() { return { error: null }; }, async createSignedUrl() { return { data: null, error: { message: 'no photos in test' } }; }, async remove() { return { error: null }; } }) },
    functions: { async invoke() { return { data: { sent: 1 }, error: null }; } },
  };
}
