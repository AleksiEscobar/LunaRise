const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

class LeadStore {
    constructor(dbPath) {
        this.path = path.resolve(dbPath || path.join(__dirname, 'data', 'leads.db'));
        this._ensureStorage();
        this.db = null;
        this.ready = this._initialize();
    }

    _ensureStorage() {
        const dir = path.dirname(this.path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    _run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function (err) {
                if (err) {
                    return reject(err);
                }
                resolve(this);
            });
        });
    }

    _get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    return reject(err);
                }
                resolve(row || null);
            });
        });
    }

    _all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    return reject(err);
                }
                resolve(rows || []);
            });
        });
    }

    async _initialize() {
        this.db = new sqlite3.Database(this.path);
        await this._run(`
            CREATE TABLE IF NOT EXISTS leads (
                id TEXT PRIMARY KEY,
                source TEXT,
                number TEXT,
                message TEXT,
                niche TEXT,
                direction TEXT,
                status TEXT,
                analysis TEXT,
                ai_response TEXT,
                response_mode TEXT,
                response_sent INTEGER,
                metadata TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        `);
        await this._run('CREATE INDEX IF NOT EXISTS idx_leads_number ON leads(number)');
        await this._run('CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)');
        await this._migrateJsonStorage();
    }

    async _migrateJsonStorage() {
        const jsonPath = path.join(path.dirname(this.path), 'leads.json');
        if (!fs.existsSync(jsonPath)) {
            return;
        }
        const existing = await this._get('SELECT COUNT(1) AS count FROM leads');
        if (existing && existing.count > 0) {
            return;
        }
        try {
            const raw = fs.readFileSync(jsonPath, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data) && data.length) {
                const insertSql = `INSERT INTO leads
                    (id, source, number, message, niche, direction, status, analysis, ai_response, response_mode, response_sent, metadata, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                for (const item of data) {
                    await this._run(insertSql, [
                        item.id || this._makeId(item),
                        item.source || 'unknown',
                        item.number,
                        item.message,
                        item.niche || null,
                        item.direction || 'incoming',
                        item.status || 'new',
                        item.analysis || null,
                        item.ai_response || null,
                        item.response_mode || null,
                        item.response_sent ? 1 : 0,
                        item.metadata ? JSON.stringify(item.metadata) : '{}',
                        item.created_at || new Date().toISOString(),
                        item.updated_at || new Date().toISOString(),
                    ]);
                }
            }
        } catch (error) {
            console.warn('No se pudo migrar el lead store JSON:', error.message || error);
        }
    }

    _makeId(data) {
        const seed = `${data.source}:${data.number}:${data.message}:${Date.now()}`;
        return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
    }

    _normalizeLead(row) {
        if (!row) {
            return null;
        }
        return {
            ...row,
            response_sent: Boolean(row.response_sent),
            metadata: row.metadata ? JSON.parse(row.metadata) : {},
        };
    }

    async addLead(data) {
        await this.ready;
        const existing = await this.findLeadByUnique(data.source, data.number, data.message);
        if (existing) {
            return this.updateLead(existing.id, { updated_at: new Date().toISOString() });
        }

        const now = new Date().toISOString();
        const lead = {
            id: this._makeId(data),
            source: data.source || 'unknown',
            number: data.number,
            message: data.message,
            niche: data.niche || null,
            direction: data.direction || 'incoming',
            status: data.status || 'new',
            analysis: data.analysis || null,
            ai_response: data.ai_response || null,
            response_mode: data.response_mode || null,
            response_sent: data.response_sent ? 1 : 0,
            metadata: JSON.stringify(data.metadata || {}),
            created_at: now,
            updated_at: now,
        };
        const sql = `INSERT INTO leads
            (id, source, number, message, niche, direction, status, analysis, ai_response, response_mode, response_sent, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        await this._run(sql, [
            lead.id,
            lead.source,
            lead.number,
            lead.message,
            lead.niche,
            lead.direction,
            lead.status,
            lead.analysis,
            lead.ai_response,
            lead.response_mode,
            lead.response_sent,
            lead.metadata,
            lead.created_at,
            lead.updated_at,
        ]);
        return this._normalizeLead(lead);
    }

    async updateLead(id, updates) {
        await this.ready;
        const existing = await this.getLeadById(id);
        if (!existing) {
            return null;
        }

        const fields = [];
        const values = [];
        const normalized = { ...existing, ...updates, updated_at: new Date().toISOString() };

        if (updates.status !== undefined) {
            fields.push('status = ?');
            values.push(normalized.status);
        }
        if (updates.analysis !== undefined) {
            fields.push('analysis = ?');
            values.push(normalized.analysis);
        }
        if (updates.ai_response !== undefined) {
            fields.push('ai_response = ?');
            values.push(normalized.ai_response);
        }
        if (updates.response_mode !== undefined) {
            fields.push('response_mode = ?');
            values.push(normalized.response_mode);
        }
        if (updates.response_sent !== undefined) {
            fields.push('response_sent = ?');
            values.push(updates.response_sent ? 1 : 0);
        }
        if (updates.metadata !== undefined) {
            fields.push('metadata = ?');
            values.push(JSON.stringify(updates.metadata || {}));
        }
        fields.push('updated_at = ?');
        values.push(normalized.updated_at);

        if (!fields.length) {
            return existing;
        }

        values.push(id);
        const sql = `UPDATE leads SET ${fields.join(', ')} WHERE id = ?`;
        await this._run(sql, values);
        return this.getLeadById(id);
    }

    async getLeadById(id) {
        await this.ready;
        const row = await this._get('SELECT * FROM leads WHERE id = ?', [id]);
        return this._normalizeLead(row);
    }

    async findLatestByNumber(number) {
        await this.ready;
        const row = await this._get('SELECT * FROM leads WHERE number = ? ORDER BY created_at DESC LIMIT 1', [number]);
        return this._normalizeLead(row);
    }

    async findLeadByUnique(source, number, message) {
        await this.ready;
        const row = await this._get(
            'SELECT * FROM leads WHERE source = ? AND number = ? AND message = ? ORDER BY created_at DESC LIMIT 1',
            [source, number, message]
        );
        return this._normalizeLead(row);
    }

    async getAllLeads() {
        await this.ready;
        const rows = await this._all('SELECT * FROM leads ORDER BY created_at DESC');
        return rows.map((row) => this._normalizeLead(row));
    }
}

module.exports = { LeadStore };
