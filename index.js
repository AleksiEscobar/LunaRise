require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const path = require('path');
const { execFile } = require('child_process');
const { LeadStore } = require('./lead_store');

const app = express();
app.use(express.json());

const normalizePhoneNumber = (number) => {
    if (!number || typeof number !== 'string') {
        return null;
    }

    let cleaned = number.trim();
    if (cleaned.endsWith('@c.us')) {
        return cleaned;
    }

    cleaned = cleaned.replace(/\D+/g, '');
    if (!cleaned) {
        return null;
    }

    return `${cleaned}@c.us`;
};

const getTargetNumber = (number) => {
    const normalized = normalizePhoneNumber(number);
    if (!normalized) {
        throw new Error('Número inválido');
    }
    return normalized;
};

const pythonExecutable = process.env.PYTHON_EXECUTABLE || 'python';
const spyAgentCli = path.resolve('c:/LunaRise/agents/spy_agent_cli.py');

const leadStore = new LeadStore(process.env.LEAD_STORE_DB_PATH || process.env.LEAD_STORE_PATH);
const DEFAULT_LEAD_NICHE = process.env.DEFAULT_LEAD_NICHE || 'Prospecto WhatsApp';
const DEFAULT_N8N_WEBHOOK_URL = 'http://localhost:3000/n8n/webhook/lead';
const WHATSAPP_LEAD_WEBHOOK_URL = process.env.N8N_LEAD_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL || DEFAULT_N8N_WEBHOOK_URL;
const N8N_LEAD_UPDATE_URL = process.env.N8N_LEAD_UPDATE_URL || WHATSAPP_LEAD_WEBHOOK_URL;
const WHATSAPP_AUTO_LEAD_REPLY = process.env.WHATSAPP_AUTO_LEAD_REPLY === 'true';

const buildWhatsappLeadAnalysisQuery = (niche, message) => {
    return `Lead entrante desde WhatsApp para nicho '${niche}': ${message}\n\nGenera un breve resumen de oportunidad, un mensaje de seguimiento directo para WhatsApp y tres puntos clave de valor.`;
};

const runSpyAgent = (args) => {
    const env = { ...process.env };
    return new Promise((resolve, reject) => {
        execFile(pythonExecutable, args, { env, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(stderr || error.message));
            }

            try {
                const json = JSON.parse(stdout);
                if (json.status === 'ok') {
                    return resolve(json.result);
                }
                return reject(new Error(json.error || 'Error desconocido desde SpyAgent'));
            } catch (parseError) {
                return reject(new Error(`No se pudo parsear la respuesta de SpyAgent: ${parseError.message}`));
            }
        });
    });
};

const buildLeadAnalysisQuery = (niche, message) => {
    return `Nicho: ${niche}\nMensaje: ${message}\n\nAnaliza este lead y genera:\n1) Un breve resumen de oportunidad.\n2) Una propuesta de seguimiento de WhatsApp en tono directo y conversacional.\n3) Tres puntos clave de valor para cerrar.`;
};

const buildFallbackAIPrompt = (niche, message) => {
    return `Eres un asistente de marketing directo. Un nuevo lead llegó para el nicho '${niche}' con el siguiente mensaje: '${message}'. Genera una respuesta breve y amigable para WhatsApp que invite al prospecto a continuar la conversación y destaque el beneficio principal.`;
};

const postToN8n = async (url, payload) => {
    try {
        await axios.post(url, payload, { timeout: 10000 });
        return true;
    } catch (error) {
        console.warn('Fallo al enviar datos a n8n:', error.message || error);
        if (url !== DEFAULT_N8N_WEBHOOK_URL) {
            console.warn(`Intentando fallback local a ${DEFAULT_N8N_WEBHOOK_URL}`);
            try {
                await axios.post(DEFAULT_N8N_WEBHOOK_URL, payload, { timeout: 10000 });
                return true;
            } catch (fallbackError) {
                console.warn('Fallback local a n8n también falló:', fallbackError.message || fallbackError);
            }
        }
        return false;
    }
};

app.post('/n8n/webhook/lead', (req, res) => {
    console.log('Local n8n webhook recibido:', JSON.stringify(req.body, null, 2));
    return res.json({ status: 'ok', received: true });
});

const buildLeadPayload = (lead) => ({
    id: lead.id,
    source: lead.source,
    number: lead.number,
    message: lead.message,
    niche: lead.niche,
    direction: lead.direction,
    status: lead.status,
    analysis: lead.analysis,
    ai_response: lead.ai_response,
    response_mode: lead.response_mode,
    response_sent: lead.response_sent,
    metadata: lead.metadata || {},
    created_at: lead.created_at,
    updated_at: lead.updated_at,
});

const notifyLeadUpdate = async (lead) => {
    if (!N8N_LEAD_UPDATE_URL || !lead) {
        return false;
    }
    return await postToN8n(N8N_LEAD_UPDATE_URL, buildLeadPayload(lead));
};

const buildLeadQualificationPrompt = (lead) => {
    return `Eres un asistente de calificación de leads. Revisa el siguiente lead:

Número: ${lead.number}
Nicho: ${lead.niche}
Mensaje: ${lead.message}

Genera:
1) Un breve análisis de intención.
2) Una calificación de lead: alta, media o baja.
3) Un estado recomendado para el lead.
4) Un comentario de seguimiento breve para WhatsApp.`;
};

const buildFallbackQualification = (lead) => {
    return `Análisis de intención: el prospecto muestra interés inicial y merece seguimiento.
Calificación: media.
Estado recomendado: ${lead.status === 'captured' ? 'qualified' : lead.status}.
Comentario de seguimiento: Gracias por tu mensaje. Estoy revisando tu caso y pronto te envío una propuesta clara para avanzar.`;
};

const attachResponseToLead = async (number, response, mode) => {
    const lead = await leadStore.findLatestByNumber(number);
    if (!lead) {
        return;
    }
    await leadStore.updateLead(lead.id, {
        ai_response: response,
        response_mode: mode,
        response_sent: true,
        status: 'replied',
    });
};

const handleIncomingWhatsappMessage = async (msg, text) => {
    const lower = text.toLowerCase();
    if (msg.from.endsWith('@g.us')) {
        return;
    }
    if (lower.startsWith('/ai') || lower.startsWith('/market') || lower === '/status') {
        return;
    }

    const lead = await leadStore.addLead({
        source: 'whatsapp',
        number: msg.from,
        message: text,
        niche: DEFAULT_LEAD_NICHE,
        direction: 'incoming',
        status: 'captured',
    });

    if (WHATSAPP_LEAD_WEBHOOK_URL) {
        await postToN8n(WHATSAPP_LEAD_WEBHOOK_URL, buildLeadPayload(lead));
    }

    await client.sendMessage(msg.from, 'Gracias, tu mensaje fue registrado como lead. Pronto recibirás seguimiento.');

    if (!WHATSAPP_AUTO_LEAD_REPLY) {
        return;
    }

    try {
        const analysisQuery = buildWhatsappLeadAnalysisQuery(lead.niche, lead.message);
        const analysis = await runSpyAgent([spyAgentCli, '--query', analysisQuery, '--mode', 'ai']);
        await leadStore.updateLead(lead.id, {
            analysis,
            ai_response: analysis,
            response_mode: 'auto-lead',
            response_sent: true,
            status: 'replied',
        });
        await client.sendMessage(msg.from, `Este es un resumen rápido de tu mensaje:\n\n${analysis}`);

        if (WHATSAPP_LEAD_WEBHOOK_URL) {
            const updatedLead = await leadStore.findLatestByNumber(lead.number);
            await postToN8n(WHATSAPP_LEAD_WEBHOOK_URL, buildLeadPayload(updatedLead));
        }
    } catch (error) {
        console.warn('Error generando respuesta automática para lead de WhatsApp:', error.message || error);
    }
};

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'] }
});

client.on('qr', qr => {
    console.log('QR generado — escanealo con el Moto G14:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp conectado y listo');
});

client.on('message', async msg => {
    console.log(`Mensaje de ${msg.from}: ${msg.body}`);

    const text = msg.body && msg.body.trim();
    if (!text) {
        return;
    }

    try {
        if (text.toLowerCase().startsWith('/ai ')) {
            const prompt = text.slice(4).trim();
            if (!prompt) {
                await client.sendMessage(msg.from, 'Por favor envía un prompt después de /ai.');
                return;
            }
            const aiResponse = await runSpyAgent([spyAgentCli, '--query', prompt, '--mode', 'ai']);
            await client.sendMessage(msg.from, aiResponse);
        } else if (text.toLowerCase().startsWith('/market ')) {
            const query = text.slice(8).trim();
            if (!query) {
                await client.sendMessage(msg.from, 'Por favor envía una consulta después de /market.');
                return;
            }
            const marketResponse = await runSpyAgent([spyAgentCli, '--query', query, '--mode', 'market']);
            await client.sendMessage(msg.from, marketResponse);
        } else if (text.toLowerCase() === '/status') {
            const statusResponse = await runSpyAgent([spyAgentCli, '--mode', 'status']);
            await client.sendMessage(msg.from, `AI STATUS:\n${JSON.stringify(statusResponse, null, 2)}`);
        } else {
            await handleIncomingWhatsappMessage(msg, text);
        }
    } catch (error) {
        console.error('Error procesando comando de WhatsApp:', error.message || error);
        await client.sendMessage(msg.from, `Error en IA: ${error.message || 'Fallo desconocido'}`);
    }
});

app.post('/send', async (req, res) => {
    const { number, message } = req.body;
    try {
        const target = getTargetNumber(number);
        await client.sendMessage(target, message);
        res.json({ status: 'sent', target });
    } catch (error) {
        console.error('Error en /send:', error.message || error);
        res.status(400).json({ status: 'error', message: error.message || 'Número inválido o envío fallido.' });
    }
});

app.post('/webhook', async (req, res) => {
    const { action, number, text } = req.body || {};

    if (action !== 'send' || !number || !text) {
        console.warn('Webhook inválido recibido:', req.body);
        return res.status(400).json({ status: 'error', message: 'Payload inválido. Se requiere action=send, number y text.' });
    }

    try {
        const target = getTargetNumber(number);
        await client.sendMessage(target, text);
        return res.json({ status: 'sent', number: target });
    } catch (error) {
        console.error('Error enviando mensaje desde webhook:', error.message || error);
        return res.status(500).json({ status: 'error', message: error.message || 'Error enviando mensaje.' });
    }
});

app.post('/lead', async (req, res) => {
    const { niche, number, message } = req.body || {};
    const webhookUrl = process.env.N8N_WEBHOOK_URL || WHATSAPP_LEAD_WEBHOOK_URL;

    if (!niche || !number || !message) {
        return res.status(400).json({ status: 'error', message: 'Se requieren niche, number y message.' });
    }

    const target = getTargetNumber(number);
    const leadRecord = await leadStore.addLead({
        source: 'api',
        number: target,
        message,
        niche,
        direction: 'incoming',
        status: 'captured',
    });

    if (webhookUrl) {
        await postToN8n(webhookUrl, { niche, number, message });
    }

    let analysis = null;
    let responseSent = false;
    let analysisError = null;

    const marketQuery = buildLeadAnalysisQuery(niche, message);
    const analysisWebhookUrl = process.env.N8N_LEAD_ANALYSIS_URL || webhookUrl;

    try {
        analysis = await runSpyAgent([spyAgentCli, '--query', marketQuery, '--mode', 'market']);
    } catch (marketError) {
        console.warn('Market analysis failed, fallback to AI mode:', marketError.message || marketError);
        try {
            const fallbackQuery = buildFallbackAIPrompt(niche, message);
            analysis = await runSpyAgent([spyAgentCli, '--query', fallbackQuery, '--mode', 'ai']);
        } catch (aiError) {
            analysisError = aiError;
            console.error('AI fallback also failed for lead analysis:', aiError.message || aiError);
        }
    }

    if (analysis) {
        try {
            const leadResponse = `Gracias por tu interés. Aquí hay una propuesta rápida para este lead:\n\n${analysis}`;
            await client.sendMessage(target, leadResponse);
            responseSent = true;
            await leadStore.updateLead(leadRecord.id, {
                analysis,
                ai_response: analysis,
                response_mode: 'lead-api',
                response_sent: true,
                status: 'replied',
            });
        } catch (whatsappError) {
            console.error('Error enviando respuesta automática al lead:', whatsappError.message || whatsappError);
            await leadStore.updateLead(leadRecord.id, { status: 'analyzed' });
        }

        if (analysisWebhookUrl) {
            const updatedLead = await leadStore.findLatestByNumber(target);
            const payload = buildLeadPayload(updatedLead);
            await postToN8n(analysisWebhookUrl, payload);
        }
    }

    return res.json({
        status: 'sent-to-n8n',
        webhookUrl,
        analysisWebhookUrl,
        analysis: analysis || null,
        responseSent,
        analysisError: analysisError ? String(analysisError) : null,
    });
});

app.post('/lead/convert', async (req, res) => {
    const { number, message, niche } = req.body || {};
    if (!number || !message) {
        return res.status(400).json({ status: 'error', message: 'Se requieren number y message.' });
    }

    let target;
    try {
        target = getTargetNumber(number);
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }

    const lead = await leadStore.addLead({
        source: 'whatsapp-conversion',
        number: target,
        message,
        niche: niche || DEFAULT_LEAD_NICHE,
        direction: 'incoming',
        status: 'captured',
    });

    if (WHATSAPP_LEAD_WEBHOOK_URL) {
        await postToN8n(WHATSAPP_LEAD_WEBHOOK_URL, buildLeadPayload(lead));
    }

    return res.json({ status: 'ok', lead });
});

app.get('/leads', async (req, res) => {
    const { status, source, number } = req.query;
    let leads = await leadStore.getAllLeads();
    if (status) {
        leads = leads.filter((lead) => lead.status === status);
    }
    if (source) {
        leads = leads.filter((lead) => lead.source === source);
    }
    if (number) {
        leads = leads.filter((lead) => lead.number === number);
    }
    return res.json({ status: 'ok', leads });
});

app.get('/leads/summary', async (req, res) => {
    const leads = await leadStore.getAllLeads();
    const summary = leads.reduce((acc, lead) => {
        acc.total += 1;
        acc.byStatus[lead.status] = (acc.byStatus[lead.status] || 0) + 1;
        acc.bySource[lead.source] = (acc.bySource[lead.source] || 0) + 1;
        return acc;
    }, { total: 0, byStatus: {}, bySource: {} });
    return res.json({ status: 'ok', summary, leads_count: leads.length });
});

app.get('/leads/:id', async (req, res) => {
    const lead = await leadStore.getLeadById(req.params.id);
    if (!lead) {
        return res.status(404).json({ status: 'error', message: 'Lead no encontrado.' });
    }
    return res.json({ status: 'ok', lead });
});

app.patch('/leads/:id', async (req, res) => {
    const updates = req.body || {};
    const allowed = ['status', 'analysis', 'ai_response', 'response_mode', 'response_sent', 'metadata'];
    const payload = {};
    for (const key of allowed) {
        if (updates[key] !== undefined) {
            payload[key] = updates[key];
        }
    }
    if (!Object.keys(payload).length) {
        return res.status(400).json({ status: 'error', message: 'No hay campos válidos para actualizar.' });
    }
    const lead = await leadStore.updateLead(req.params.id, payload);
    if (!lead) {
        return res.status(404).json({ status: 'error', message: 'Lead no encontrado.' });
    }
    await notifyLeadUpdate(lead);
    return res.json({ status: 'ok', lead });
});

app.post('/leads/:id/notify', async (req, res) => {
    const lead = await leadStore.getLeadById(req.params.id);
    if (!lead) {
        return res.status(404).json({ status: 'error', message: 'Lead no encontrado.' });
    }
    const ok = await notifyLeadUpdate(lead);
    return res.json({ status: ok ? 'ok' : 'error', lead, notified: ok });
});

app.post('/leads/:id/qualify', async (req, res) => {
    const lead = await leadStore.getLeadById(req.params.id);
    if (!lead) {
        return res.status(404).json({ status: 'error', message: 'Lead no encontrado.' });
    }
    let qualification;
    try {
        qualification = await runSpyAgent([spyAgentCli, '--query', buildLeadQualificationPrompt(lead), '--mode', 'ai']);
    } catch (error) {
        console.warn('AI no disponible para calificar lead, usando fallback local:', error.message || error);
        qualification = buildFallbackQualification(lead);
    }

    const updatedLead = await leadStore.updateLead(lead.id, {
        analysis: qualification,
        ai_response: qualification,
        response_mode: 'qualification',
        response_sent: false,
        status: 'qualified',
    });
    await notifyLeadUpdate(updatedLead);
    return res.json({ status: 'ok', lead: updatedLead, qualification });
});

app.post('/ai', async (req, res) => {
    const { number, prompt, mode } = req.body || {};

    if (!number || !prompt) {
        return res.status(400).json({ status: 'error', message: 'Se requieren number y prompt.' });
    }

    let target;
    try {
        target = getTargetNumber(number);
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }

    try {
        const aiResponse = await runSpyAgent([spyAgentCli, '--query', prompt, '--mode', mode === 'market' ? 'market' : 'ai']);
        await client.sendMessage(target, aiResponse);
        await attachResponseToLead(target, aiResponse, mode === 'market' ? 'market' : 'ai');
        return res.json({ status: 'sent', number: target, ai_response: aiResponse });
    } catch (error) {
        console.error('Error en /ai:', error.message || error);
        return res.status(500).json({ status: 'error', message: 'Fallo al generar o enviar la respuesta de IA.', details: error.message });
    }
});

app.post('/market', async (req, res) => {
    const { number, query } = req.body || {};

    if (!number || !query) {
        return res.status(400).json({ status: 'error', message: 'Se requieren number y query.' });
    }

    let target;
    try {
        target = getTargetNumber(number);
    } catch (error) {
        return res.status(400).json({ status: 'error', message: error.message });
    }

    try {
        const marketResponse = await runSpyAgent([spyAgentCli, '--query', query, '--mode', 'market']);
        await client.sendMessage(target, marketResponse);
        await attachResponseToLead(target, marketResponse, 'market');
        return res.json({ status: 'sent', number: target, market_response: marketResponse });
    } catch (error) {
        console.error('Error en /market:', error.message || error);
        return res.status(500).json({ status: 'error', message: 'Fallo al generar o enviar la respuesta de mercado.', details: error.message });
    }
});

app.get('/ai/status', async (req, res) => {
    try {
        const statusData = await runSpyAgent([spyAgentCli, '--mode', 'status']);
        return res.json({ status: 'ok', ai_status: statusData });
    } catch (error) {
        console.error('Error en /ai/status:', error.message || error);
        return res.status(500).json({ status: 'error', message: 'Fallo al obtener el estado de IA.', details: error.message });
    }
});

app.get('/status', (req, res) => {
    res.json({ status: 'running' });
});

const start = async () => {
    await leadStore.ready;
    client.initialize();
    app.listen(3000, () => console.log('Servidor corriendo en puerto 3000'));
};

start().catch((error) => {
    console.error('Error al iniciar el servidor:', error);
    process.exit(1);
});