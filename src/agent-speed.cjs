'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {UUID} = require('./protocol.cjs');

// Called in the usage worker. Open briefly so Agent Speed can replace its database.
class AgentSpeed {
  constructor(database) {
    this.database = database;
    this.retryAt = 0;
  }
  query(read) {
    if (!this.database || Date.now() < this.retryAt) return null;
    let db;
    try {
      const {DatabaseSync} = require('node:sqlite');
      db = new DatabaseSync(this.database, {readOnly:true, timeout:0});
      return read(db);
    } catch {
      this.retryAt = Date.now() + 30000;
      return null;
    } finally {
      db?.close();
    }
  }
  find(home, id) {
    if (!UUID.test(id)) return null;
    const rows = this.query(db => db.prepare(
      "SELECT path FROM files WHERE family = 'Codex' AND path LIKE ? LIMIT 8"
    ).all('%-' + id + '.jsonl'));
    if (!rows) return null;
    const roots = ['sessions','archived_sessions'].map(name => path.resolve(home,name));
    const within = file => roots.some(root => {
      const relative = path.relative(root,file);
      return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
    });
    for (const row of rows) {
      const file = row.path;
      if (typeof file !== 'string' || !path.isAbsolute(file) || !within(file) ||
          !path.basename(file).toLowerCase().endsWith('-' + id + '.jsonl')) continue;
      try {
        if (within(fs.realpathSync(file)) && fs.statSync(file).isFile()) return file;
      } catch { /* An archived or removed file will be located by Codex. */ }
    }
    return null;
  }
  measuredSpeed(filename, stat) {
    // files.modified uses .NET UTC ticks. Convert inside SQLite before JS sees it.
    const row = this.query(db => db.prepare(`
      SELECT SUM(c.measured_output) AS tokens, SUM(c.measured_ms) AS ms
      FROM files f JOIN contributions c ON c.file_id = f.id
      WHERE f.path = ? AND f.family = 'Codex' AND c.source = 'codex'
        AND f.size = ? AND (f.modified - 621355968000000000) / 10000 = ?
        AND c.measured_ms > 0 AND c.measured_output > 0
    `).get(filename,stat.size,Math.floor(stat.mtimeMs)));
    if (!Number.isSafeInteger(row?.tokens) || !Number.isSafeInteger(row.ms) || row.ms <= 0 || row.tokens <= 0) return null;
    return row.tokens * 1000 / row.ms;
  }
}
module.exports = {AgentSpeed};
