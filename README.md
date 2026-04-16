# WhatsApp Lead Qualification Bot

## Requisitos
- Node.js 18+ instalado
- `npm install` en `C:\Projects\infraestructura\whatsapp`
- `GOOGLE_API_KEY` configurada en el entorno si usas el backup Gemini
- n8n disponible en `http://localhost:5678` (docker-compose)

## Cómo iniciar el servidor WhatsApp
```powershell
cd C:\Projects\infraestructura\whatsapp
npm install
npm start
```

## Cómo ejecutar pruebas rápidas
```powershell
cd C:\Projects\infraestructura\whatsapp
npm run test:api
```

## Cómo ejecutar la prueba completa
```powershell
cd C:\Projects\infraestructura\whatsapp
npm run test:full
```

## Endpoints disponibles
- `POST /send`
- `POST /webhook`
- `POST /lead`
- `POST /lead/convert`
- `GET /leads`
- `GET /leads/summary`
- `GET /leads/:id`
- `PATCH /leads/:id`
- `POST /leads/:id/notify`
- `POST /leads/:id/qualify`
- `POST /ai`
- `POST /market`
- `GET /ai/status`
- `GET /status`

## Filtros de `/leads`
Se puede filtrar con query string:
- `?status=captured`
- `?source=whatsapp`
- `?number=5215512345678`

## Uso de `/leads/summary`
Devuelve un resumen de leads con conteos totales, por estado y por fuente.

## Uso de `/webhook`
Enviar un JSON como:
```json
{
  "action": "send",
  "number": "5215512345678",
  "text": "Tu mensaje de seguimiento aquí."
}
```

## Uso de `/lead/convert`
Enviar un JSON como:
```json
{
  "number": "5215512345678",
  "message": "Interesado en su servicio de marketing",
  "niche": "Marketing digital"
}
```

## Uso de `/leads/:id`
PATCH con campos permitidos: `status`, `analysis`, `ai_response`, `response_mode`, `response_sent`, `metadata`.

## n8n
- Importa `whatsapp_lead_qualification_workflow.json` en la instancia de n8n.
- Configura `GOOGLE_API_KEY` en n8n como variable de entorno del workflow o como credencial.
- El flujo usa `http://localhost:11434/api/generate` para Ollama y `gemini-1.5-flash` como backup.
- Si `localhost:5678` no está disponible, el servidor ahora puede recibir webhooks internamente en `/n8n/webhook/lead` como fallback local.

## Estado actual
- `index.js` ya tiene el endpoint `/webhook`.
- `whatsapp_lead_qualification_workflow.json` está listo para importar.
