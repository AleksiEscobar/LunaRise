# Workflow n8n: Lead Qualification Bot para Salud / Finanzas / Productividad

## Objetivo
Crear en n8n un flujo que reciba un lead, envíe el texto a Ollama (`Qwen2.5-Coder:7b`), y use el endpoint `/webhook` de `index.js` para responder por WhatsApp.

## Requisitos
- n8n instalado y accesible.
- Ollama corriendo local en `http://localhost:11434`.
- `index.js` de WhatsApp disponible en `http://localhost:3000`.

## Nodo 1: Webhook
- Tipo: `Webhook`
- Método: `POST`
- Path: `/lead-qualification`
- Payload de ejemplo:
  ```json
  {
    "number": "5215512345678",
    "message": "Hola, estoy interesado en una solución de productividad.",
    "niche": "Productividad"
  }
  ```

## Nodo 2: Set
- Crear variables para construir el prompt a Ollama.
- Campos sugeridos:
  - `niche`: `{{$json["niche"]}}`
  - `message`: `{{$json["message"]}}`
  - `prompt`:
    ```text
    Eres un bot de calificación de leads especializado en nichos de Salud, Finanzas y Productividad.
    Recibe este mensaje de un posible cliente y responde con:
    1) Clasificación: Alto, Medio o Bajo interés.
    2) Tres razones clave de por qué es un lead calificado.
    3) Sugerencia de siguiente paso breve.

    Mensaje:
    {{ $json["message"] }}
    Nicho: {{ $json["niche"] }}
    ```

## Nodo 3: HTTP Request a Ollama
- Método: `POST`
- URL: `http://localhost:11434/api/generate`
- Headers: `Content-Type: application/json`
- Body JSON:
  ```json
  {
    "model": "qwen2.5-coder:7b",
    "prompt": "{{$node["Set"].json["prompt"]}}",
    "stream": false
  }
  ```

## Nodo 4: Function (parse respuesta)
- Usar este nodo para extraer la respuesta de Ollama y construir el texto de WhatsApp.
- Código de ejemplo:
  ```js
  const aiText = $json["response"] || $json["choices"]?.[0]?."text" || $json;
  return [{
    number: $json["number"],
    replyText: `Lead calificado:\n${aiText}`
  }];
  ```

## Nodo 5: HTTP Request a `/webhook`
- Método: `POST`
- URL: `http://localhost:3000/webhook`
- Headers: `Content-Type: application/json`
- Body JSON:
  ```json
  {
    "action": "send",
    "number": "{{$json["number"]}}",
    "text": "{{$json["replyText"]}}"
  }
  ```

## Fallback a Gemini
- Si Ollama no responde o falla el request, el workflow puede usar la ruta de respaldo a `gemini-1.5-flash`.
- Usa la variable de entorno `GOOGLE_API_KEY` en n8n para la llamada de backup.

## Resultado
- n8n recibe leads por webhook.
- El flujo envía el mensaje a Ollama (`Qwen2.5-coder:7b`).
- Si falla, usa `gemini-1.5-flash` como fallback.
- Se genera una calificación y una respuesta de seguimiento.
- El bot envía la respuesta final al contacto WhatsApp usando `/webhook`.

## Artefacto creado
- `whatsapp_lead_qualification_workflow.json`: flujo n8n exportable para importar directamente en la instancia de n8n.

## Notas
- Ajusta el prompt para Salud, Finanzas o Productividad según cada campaña.
- Si necesitas un segundo ciclo de preguntas, agrega un nodo de `IF` y nuevas llamadas a Ollama.
