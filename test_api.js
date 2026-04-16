require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const payloadPath = path.resolve(__dirname, 'test_payload.json');

const log = (title, data) => {
  console.log(`\n=== ${title} ===`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};

const loadPayload = () => {
  try {
    return JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  } catch (error) {
    throw new Error(`No se pudo leer test_payload.json: ${error.message}`);
  }
};

const request = async (method, url, body) => {
  const config = {
    method,
    url: `${BASE_URL}${url}`,
    data: body,
    timeout: 15000,
  };
  const response = await axios(config);
  return response.data;
};

const main = async () => {
  console.log('Iniciando pruebas de API contra', BASE_URL);

  const status = await request('get', '/status');
  log('Server status', status);

  const aiStatus = await request('get', '/ai/status');
  log('AI status', aiStatus);

  const payload = loadPayload();
  const convertLead = await request('post', '/lead/convert', payload);
  log('Lead convert result', convertLead);

  const leadId = convertLead.lead && convertLead.lead.id;
  if (!leadId) {
    throw new Error('No se obtuvo id de lead desde /lead/convert');
  }

  const summary = await request('get', '/leads/summary');
  log('Lead summary', summary);

  const leadDetail = await request('get', `/leads/${leadId}`);
  log('Lead detail', leadDetail);

  const qualified = await request('post', `/leads/${leadId}/qualify`);
  log('Lead qualification', qualified);

  const notify = await request('post', `/leads/${leadId}/notify`);
  log('Lead notify', notify);

  const patched = await request('patch', `/leads/${leadId}`, {
    status: 'contacted',
    metadata: { testedAt: new Date().toISOString() },
  });
  log('Lead patch', patched);

  console.log('\nPruebas completadas. Si todos los pasos son OK, el API local está funcionando.');
};

main().catch((error) => {
  console.error('Error en pruebas:', error.message || error);
  process.exit(1);
});
