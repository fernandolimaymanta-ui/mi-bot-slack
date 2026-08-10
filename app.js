require('dotenv').config();
const { App } = require('@slack/bolt');
const axios = require('axios');
const Tesseract = require('tesseract.js');

// Inicializa la aplicación con tus tokens ocultos
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Escucha cualquier mensaje que contenga la palabra "hola"
app.message('hola', async ({ message, say }) => {
  await say(`¡Hola <@${message.user}>! Mi código ya está funcionando.`);
});

// Inicia la aplicación
(async () => {
  await app.start();
  console.log('⚡️ ¡El bot de Slack está en línea y escuchando!');
})();

// Servidor web falso (Dummy Server) para engañar a Render
// Render requiere que todos los "Web Services" abran un puerto HTTP.
// Como usamos Socket Mode, abrimos este puerto solo para que Render pase la validación.
const http = require('http');
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/webhook/salesforce/aprobacion') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        // Despachar el flujo de aprobación comercial
        await iniciarAprobacionComercial(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (error) {
        console.error("Error parseando webhook:", error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Request' }));
      }
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('El bot de Slack está ejecutándose en Socket Mode.');
  }
}).listen(port, () => {
  console.log(`Servidor HTTP de respaldo escuchando en el puerto ${port} para Render (y Webhooks)`);
});

// Escucha el comando /crear-tarea para abrir un modal
app.command('/crear-tarea', async ({ command, ack, client, logger }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'modal_crear_tarea',
        title: {
          type: 'plain_text',
          text: 'Crear nueva tarea'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Por favor, ingresa los detalles de la tarea.'
            }
          },
          {
            type: 'input',
            block_id: 'bloque_titulo',
            element: {
              type: 'plain_text_input',
              action_id: 'input_titulo'
            },
            label: {
              type: 'plain_text',
              text: 'Título de la tarea'
            }
          }
        ],
        submit: {
          type: 'plain_text',
          text: 'Guardar'
        }
      }
    });
  } catch (error) {
    logger.error("Error abriendo el modal:", error);
  }
});

// Maneja el envío del modal de crear tarea
app.view('modal_crear_tarea', async ({ ack, body, view, client, logger }) => {
  await ack();

  const titulo = view.state.values['bloque_titulo']['input_titulo'].value;
  const usuario = body.user.id;

  try {
    await client.chat.postMessage({
      channel: usuario,
      text: `✅ ¡Listo! Tu tarea "*${titulo}*" ha sido registrada.`
    });
  } catch (error) {
    logger.error("Error enviando mensaje de confirmación:", error);
  }
});

// ... (tu configuración inicial y app.message quedan arriba) ...

// ==========================================
// FLUJO: APROBACIONES QROMA (SALESFORCE)
// ==========================================

async function iniciarAprobacionComercial(payload, client, respond) {
  // payload esperado: { cliente, solicitud, impacto, justificacion, fechaLimite, ejecutivoId, aprobadorId, canalNotificacion }
  const canal = payload.canalNotificacion || process.env.CANAL_APROBACIONES || payload.ejecutivoId; 
  
  try {
    const chatClient = client || app.client;
    const result = await chatClient.chat.postMessage({
      channel: canal,
      text: `Nueva Solicitud de Aprobación QROMA: ${payload.cliente}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Aprobación QROMA Requerida",
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Aprobador asignado:* <@${payload.aprobadorId}>\n*Ejecutivo:* <@${payload.ejecutivoId}>\n\n*Cliente:* ${payload.cliente}\n*Solicitud:* ${payload.solicitud}\n*Impacto estimado:* ${payload.impacto}\n*Justificación:* ${payload.justificacion}\n*Fecha límite:* ${payload.fechaLimite}`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Aprobar",
                emoji: true
              },
              style: "primary",
              action_id: "btn_aprobar_comercial",
              value: JSON.stringify(payload)
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Rechazar",
                emoji: true
              },
              style: "danger",
              action_id: "btn_rechazar_comercial",
              value: JSON.stringify(payload)
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Pedir información",
                emoji: true
              },
              action_id: "btn_info_comercial",
              value: JSON.stringify(payload)
            }
          ]
        }
      ]
    });

    // Lógica de escalamiento simulada: Si no hay respuesta en 1 minuto, escalar.
    const messageTs = result.ts;
    setTimeout(async () => {
      try {
        await chatClient.chat.postMessage({
          channel: canal,
          thread_ts: messageTs,
          text: `⚠️ *Atención:* La solicitud de ${payload.cliente} no ha sido respondida en el tiempo definido. Escalando al siguiente nivel...`
        });
      } catch (e) {
        console.error("Error en escalamiento:", e);
      }
    }, 60000);

  } catch (error) {
    console.error("Error publicando aprobación comercial:", error);
    if (respond) {
      await respond(`⚠️ *Error publicando la tarjeta:* ${error.message}\n_Asegúrate de que el bot esté invitado al canal (escribe \`@mibot\` para invitarlo)._`);
    }
  }
}

app.command('/simular-aprobacion', async ({ command, ack, respond, client }) => {
  await ack();
  
  const text = command.text.trim();
  let aprobadorId = command.user_id; 
  
  const userMatch = text.match(/<@([a-zA-Z0-9]+)(\|.+)?>/);
  if (userMatch) {
    aprobadorId = userMatch[1];
  }

  const payloadSimulado = {
    cliente: "ABC S.A.",
    solicitud: "Descuento adicional de 8%",
    impacto: "S/ 12,000",
    justificacion: "Renovación de contrato",
    fechaLimite: "Hoy, 4 p.m.",
    ejecutivoId: command.user_id,
    aprobadorId: aprobadorId,
    canalNotificacion: command.channel_id
  };

  await respond("Generando simulación de aprobación QROMA en el canal...");
  await iniciarAprobacionComercial(payloadSimulado, client, respond);
});

app.action(/btn_(aprobar|rechazar|info)_comercial/, async ({ ack, body, action, client, logger }) => {
  await ack();
  
  const actionType = action.action_id.split('_')[1];
  const payloadStr = action.value;
  
  let titulo = "Decisión QROMA";
  let labelDecision = "Comentario de Decisión";
  let placeholderDecision = "Deja un comentario sobre tu decisión...";
  
  if (actionType === "info") {
    titulo = "Solicitar Información";
    labelDecision = "Información Requerida";
    placeholderDecision = "¿Qué información necesitas del ejecutivo?";
  }

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'modal_decision_comercial',
        private_metadata: JSON.stringify({
          actionType: actionType,
          originalPayload: payloadStr,
          channel: body.channel.id,
          messageTs: body.message.ts
        }),
        title: {
          type: 'plain_text',
          text: titulo.substring(0, 24)
        },
        submit: {
          type: 'plain_text',
          text: 'Enviar'
        },
        close: {
          type: 'plain_text',
          text: 'Cancelar'
        },
        blocks: [
          {
            type: 'input',
            block_id: 'bloque_comentario',
            element: {
              type: 'plain_text_input',
              action_id: 'input_comentario',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: placeholderDecision
              }
            },
            label: {
              type: 'plain_text',
              text: labelDecision
            }
          }
        ]
      }
    });
  } catch (error) {
    logger.error("Error abriendo modal comercial:", error);
  }
});

app.view('modal_decision_comercial', async ({ ack, body, view, client, logger }) => {
  await ack();

  try {
    const meta = JSON.parse(view.private_metadata);
    const originalPayload = JSON.parse(meta.originalPayload);
    const comentario = view.state.values.bloque_comentario.input_comentario.value;
    const actionType = meta.actionType;
    const userRealizoAccion = body.user.id;

    let estadoTexto = "Aprobado ✅";
    if (actionType === "rechazar") estadoTexto = "Rechazado ❌";
    if (actionType === "info") estadoTexto = "Pendiente de Información ⚠️";

    await client.chat.update({
      channel: meta.channel,
      ts: meta.messageTs,
      text: `Solicitud QROMA - ${estadoTexto}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `Aprobación QROMA: ${estadoTexto}`,
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Aprobador asignado:* <@${originalPayload.aprobadorId}>\n*Ejecutivo:* <@${originalPayload.ejecutivoId}>\n\n*Cliente:* ${originalPayload.cliente}\n*Solicitud:* ${originalPayload.solicitud}\n*Impacto:* ${originalPayload.impacto}\n*Justificación:* ${originalPayload.justificacion}\n*Fecha límite:* ${originalPayload.fechaLimite}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Decisión tomada por:* <@${userRealizoAccion}>\n*Comentario:*\n> ${comentario}`
          }
        }
      ]
    });

    await client.chat.postMessage({
      channel: originalPayload.ejecutivoId,
      text: `Tu solicitud para ${originalPayload.cliente} ha sido revisada.`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `Decisión: ${estadoTexto}` }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `El responsable <@${userRealizoAccion}> ha revisado tu solicitud para el cliente *${originalPayload.cliente}*.\n\n*Comentario/Feedback:*\n> ${comentario}`
          }
        }
      ]
    });

    console.log(`[SALESFORCE SIMULACIÓN] Actualizando registro en Salesforce.`);
    console.log(`Payload enviado:`, {
      cliente: originalPayload.cliente,
      estado: estadoTexto,
      aprobador: userRealizoAccion,
      comentario: comentario
    });

  } catch (error) {
    logger.error("Error procesando decisión comercial:", error);
  }
});

// ==========================================
// FLUJO PROFESIONAL: SOLICITUD DE APROBACIÓN
// ==========================================

// 1. Escucha el comando /pedir-aprobacion [@usuario]
app.command('/pedir-aprobacion', async ({ command, ack, client, respond, logger }) => {
  await ack();

  // Extraemos la mención del usuario del texto del comando (ej. "@carlos")
  // Extraemos la mención del usuario del texto del comando (ej. "@carlos")
  const text = command.text.trim();
  let targetUserId = null;

  // Opción 1: Slack envía el código interno (ej. <@U12345678>)
  const userMatch = text.match(/<@([a-zA-Z0-9]+)(\|.+)?>/);
  if (userMatch) {
    targetUserId = userMatch[1];
  } 
  // Opción 2: Slack envía texto literal (lo que te está pasando a ti, ej. @sergio.zuniga)
  else if (text.startsWith('@')) {
    const usernameBuscado = text.substring(1); // Quitamos la arroba
    try {
      // Buscamos en el directorio de la empresa el ID real de ese usuario
      const usersList = await client.users.list();
      const foundUser = usersList.members.find(u => 
        u.name === usernameBuscado || 
        (u.profile && u.profile.display_name === usernameBuscado)
      );
      if (foundUser) {
        targetUserId = foundUser.id;
      }
    } catch (error) {
      logger.error("Falla al buscar usuarios. Falta el permiso users:read", error);
    }
  }

  if (!targetUserId) {
    await respond(`⚠️ No pude encontrar el ID técnico para \`${text}\`. \n💡 *Solución:* Ve a la configuración de tu app en Slack, entra a "OAuth & Permissions" y asegúrate de haber añadido el permiso \`users:read\` a los Bot Token Scopes. ¡Luego reinstala la app!`);
    return;
  }
  
  const requesterId = command.user_id;

  try {
    // Enviamos un mensaje directo al usuario objetivo con un botón
    await client.chat.postMessage({
      channel: targetUserId,
      text: `Tienes una solicitud de aprobación pendiente de <@${requesterId}>.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*¡Hola!*\n<@${requesterId}> ha solicitado tu revisión para una tarea. Haz clic en el botón de abajo para ver los detalles y completar el formulario de decisión.`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Abrir Formulario de Revisión",
                emoji: true
              },
              style: "primary",
              action_id: "abrir_modal_aprobacion",
              value: requesterId // Guardamos quién lo solicitó
            }
          ]
        }
      ]
    });
    
    await respond(`✅ Solicitud enviada a <@${targetUserId}> correctamente. Te avisaré cuando responda.`);
  } catch (error) {
    logger.error("Error enviando mensaje de aprobación:", error);
  }
});

// 2. Escucha el clic en el botón para abrir el modal profesional
app.action('abrir_modal_aprobacion', async ({ body, ack, client, logger }) => {
  await ack();
  
  const requesterId = body.actions[0].value;

  try {
    await client.views.open({
      trigger_id: body.trigger_id, // ¡Aquí usamos el trigger_id del botón!
      view: {
        type: 'modal',
        callback_id: 'modal_aprobacion',
        private_metadata: requesterId, // Pasamos el solicitante oculto en el modal
        title: {
          type: 'plain_text',
          text: 'Revisión de Tarea'
        },
        submit: {
          type: 'plain_text',
          text: 'Enviar Decisión'
        },
        close: {
          type: 'plain_text',
          text: 'Cancelar'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Estás evaluando la solicitud de <@${requesterId}>. Por favor, sé lo más descriptivo posible.`
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'input',
            block_id: 'bloque_estado',
            element: {
              type: 'static_select',
              action_id: 'input_estado',
              placeholder: {
                type: 'plain_text',
                text: 'Selecciona una decisión'
              },
              options: [
                {
                  text: { type: 'plain_text', text: '✅ Aprobado', emoji: true },
                  value: 'aprobado'
                },
                {
                  text: { type: 'plain_text', text: '❌ Rechazado', emoji: true },
                  value: 'rechazado'
                },
                {
                  text: { type: 'plain_text', text: '⚠️ Requiere Cambios', emoji: true },
                  value: 'cambios'
                }
              ]
            },
            label: {
              type: 'plain_text',
              text: 'Tu Decisión Final'
            }
          },
          {
            type: 'input',
            block_id: 'bloque_comentarios',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'input_comentarios',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'Escribe el motivo de tu decisión o notas para la persona...'
              }
            },
            label: {
              type: 'plain_text',
              text: 'Comentarios o Feedback'
            }
          },
          {
            type: 'input',
            block_id: 'bloque_fecha',
            optional: true,
            element: {
              type: 'datepicker',
              initial_date: new Date().toISOString().split('T')[0],
              action_id: 'input_fecha'
            },
            label: {
              type: 'plain_text',
              text: 'Fecha límite de implementación (Opcional)'
            }
          }
        ]
      }
    });
  } catch (error) {
    logger.error("Error abriendo el modal de aprobación:", error);
  }
});

// 3. Maneja el envío del modal profesional
app.view('modal_aprobacion', async ({ ack, body, view, client, logger }) => {
  await ack();

  // Extraemos datos del formulario
  const decision = view.state.values.bloque_estado.input_estado.selected_option.text.text;
  const comentarios = view.state.values.bloque_comentarios.input_comentarios.value || "Sin comentarios adicionales.";
  const fecha = view.state.values.bloque_fecha.input_fecha.selected_date || "No especificada";
  
  const revisorId = body.user.id;
  const requesterId = view.private_metadata; 

  try {
    // Notificamos al solicitante original
    await client.chat.postMessage({
      channel: requesterId,
      text: `Tu solicitud ha sido revisada por <@${revisorId}>.`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "📋 Resultado de tu Solicitud"
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Revisor:* <@${revisorId}>\n*Decisión:* ${decision}\n*Fecha objetivo:* ${fecha}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Feedback recibido:*\n> ${comentarios}`
          }
        }
      ]
    });

    // Confirmamos al revisor
    await client.chat.postMessage({
      channel: revisorId,
      text: `✅ ¡Gracias! Tu decisión de *${decision}* fue enviada a <@${requesterId}>.`
    });

  } catch (error) {
    logger.error("Error enviando resultados de aprobación:", error);
  }
});
app.command('/predecir-churn', async ({ command, ack, respond }) => {
  // 1. Acknowledge: Siempre debes confirmar la recepción del comando inmediatamente
  await ack();

  // 2. Extraer los parámetros que el usuario escribió (ej: "1045 12 450")
  const args = command.text.split(' ');

  // Validar que se enviaron los 3 datos requeridos
  if (args.length !== 3) {
    await respond('⚠️ *Error:* Formato incorrecto. Por favor usa: `/predecir-churn [id_cliente] [meses_activo] [gasto_total]`');
    return;
  }

  const clienteId = args[0];
  const mesesActivo = parseInt(args[1]);
  const gastoTotal = parseFloat(args[2]);

  // --- SIMULACIÓN DEL MODELO DE MACHINE LEARNING ---
  // En un entorno real, aquí harías un 'fetch' o 'axios' a tu API de Python
  // const respuesta = await axios.post('http://tu-api-ml/predict', { meses: mesesActivo, gasto: gastoTotal });
  // let probabilidadChurn = respuesta.data.probabilidad;
  
  // Lógica simulada: Si tiene pocos meses y gasta poco, el riesgo es mayor.
  let probabilidadChurn = 85.5; // Valor base por defecto
  if (mesesActivo > 12 && gastoTotal > 500) probabilidadChurn = 12.3;
  if (mesesActivo > 6 && gastoTotal > 200) probabilidadChurn = 45.8;

  // 3. Determinar el nivel de riesgo para darle color al mensaje
  let nivelRiesgo = probabilidadChurn > 60 ? '🔴 Alto Riesgo' : probabilidadChurn > 30 ? '🟡 Riesgo Medio' : '🟢 Riesgo Bajo';

  // 4. Responder al usuario con los resultados
  await respond({
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `📊 Análisis de Abandono (Churn) - Cliente #${clienteId}`
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Datos analizados:*\n• Antigüedad: ${mesesActivo} meses\n• Gasto histórico: S/ ${gastoTotal}\n\n*Resultado del Modelo:*\n• Probabilidad de abandono: *${probabilidadChurn}%*\n• Diagnóstico: ${nivelRiesgo}`
        }
      }
    ]
  });
});
// ==========================================
// FLUJO: CAPTURA DE IMAGEN, OCR Y ACTUALIZACIÓN DE CANVAS
// ==========================================

// Función REAL de OCR usando Tesseract.js
async function extraerDatosOCR(urlArchivo, token) {
  try {
    console.log(`Descargando imagen desde: ${urlArchivo}`);
    
    // 1. Descargar la imagen de Slack
    const response = await axios.get(urlArchivo, {
      responseType: 'arraybuffer',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const imageBuffer = Buffer.from(response.data, 'binary');
    console.log('Imagen descargada. Iniciando reconocimiento OCR con Tesseract...');
    
    // 2. Ejecutar OCR
    const { data: { text } } = await Tesseract.recognize(
      imageBuffer,
      'spa', // Idioma español
      { logger: m => console.log(`OCR Progreso: ${m.status} ${Math.round(m.progress * 100)}%`) }
    );
    
    console.log('--- Texto Extraído ---');
    console.log(text);
    console.log('----------------------');
    
    // 3. Extraer datos con mayor precisión línea por línea
    let ruc = "No detectado";
    let fecha = "No detectada";
    let totalPagado = "No detectado";
    let razonSocial = "No detectada";
    
    // Limpiamos un poco el texto general antes de procesarlo
    const lineas = text.split('\n');
    let primeraLineaTexto = "";
    
    for (let linea of lineas) {
      linea = linea.trim();
      if (!linea) continue;
      
      // Guardar la primera línea con letras como respaldo de Razón Social (típico en tickets)
      if (!primeraLineaTexto && /[a-zA-Z]{4,}/.test(linea)) {
        primeraLineaTexto = linea.split(/[-|RUC]/i)[0].trim(); // Extrae antes del guion o la palabra RUC
      }
      
      // Buscar RUC (11 dígitos empezando con 10 o 20)
      if (ruc === "No detectado") {
        let lineaSinEspacios = linea.replace(/\s+/g, '');
        let rucMatch = lineaSinEspacios.match(/(10|20)\d{9}/);
        
        // Si la línea dice "RUC" pero no detectó los números, forzamos una corrección agresiva de OCR
        // (Ejemplo: Tesseract leyó la letra 'O' en vez del número '0', o 'S' en vez de '5')
        if (!rucMatch && /RUC/i.test(linea)) {
          let lineaCorregida = linea.toUpperCase()
            .replace(/O/g, '0').replace(/I|L/g, '1').replace(/Z/g, '2').replace(/S/g, '5').replace(/B/g, '8');
          rucMatch = lineaCorregida.replace(/\s+/g, '').match(/(10|20)\d{9}/);
        }
        
        if (rucMatch) ruc = rucMatch[0];
      }
      
      // Buscar Fecha (DD/MM/YYYY o DD-MM-YYYY)
      if (fecha === "No detectada") {
        // Unimos espacios alrededor de los slashes o guiones por si el OCR los separó
        const lineaFecha = linea.replace(/\s*\/\s*/g, '/').replace(/\s*-\s*/g, '-');
        const fechaMatch = lineaFecha.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/);
        if (fechaMatch) fecha = fechaMatch[1];
      }
      
      // Buscar Total Pagado
      if (totalPagado === "No detectado" && /TOTAL/i.test(linea)) {
        // Buscamos cualquier número con 2 decimales en la línea del total
        const totalMatch = linea.match(/(\d{1,3}(?:[,\s]?\d{3})*[\.,]\d{2})/);
        if (totalMatch) {
          totalPagado = `S/ ${totalMatch[1].replace(/\s/g, '')}`;
        }
      }
      
      // Buscar Razón Social (Búsqueda flexible de sufijos)
      if (razonSocial === "No detectada") {
        const razonMatch = linea.match(/(.+?)\s*(S\.?A\.?C\.?|S\.?A\.?|E\.?I\.?R\.?L\.?|S\.?R\.?L\.?)\b/i);
        if (razonMatch && !/RAZ\.?SOC/i.test(razonMatch[1])) {
          // Limpiar caracteres extraños al inicio
          razonSocial = razonMatch[0].replace(/^[^a-zA-ZÑÁÉÍÓÚñáéíóú0-9]+/, '').trim();
        }
      }
    }
    
    // Respaldo para Razón Social: Usar la primera línea de la factura
    if (razonSocial === "No detectada" && primeraLineaTexto) {
      razonSocial = primeraLineaTexto;
    }
    
    // ==========================================
    // RESPALDOS GLOBALES (Si la búsqueda por línea falló)
    // ==========================================
    
    // 1. Respaldo para Fecha: Buscar cualquier formato DD-MM-YYYY o YYYY-MM-DD
    if (fecha === "No detectada") {
      const textoFechas = text.replace(/\s*\/\s*/g, '/').replace(/\s*-\s*/g, '-');
      const fMatch = textoFechas.match(/\b(\d{2,4}[\/\-]\d{2}[\/\-]\d{2,4})\b/);
      if (fMatch) {
        fecha = fMatch[1];
      }
    }
    
    // 2. Respaldo para Total: Heurística del número mayor
    // En el 99% de facturas, el "Total" es el número más grande con 2 decimales
    if (totalPagado === "No detectado") {
      const todosLosPrecios = text.match(/\b\d{1,6}[\.,]\d{2}\b/g);
      if (todosLosPrecios) {
        let maxMonto = 0;
        for (let precioStr of todosLosPrecios) {
          // Reemplazar coma por punto por si el OCR leyó "708,00"
          let valor = parseFloat(precioStr.replace(',', '.'));
          if (valor > maxMonto) {
            maxMonto = valor;
          }
        }
        if (maxMonto > 0) {
          totalPagado = `S/ ${maxMonto.toFixed(2)}`;
        }
      }
    }

    return {
      fecha,
      ruc,
      razonSocial,
      totalPagado
    };
    
  } catch (error) {
    console.error("Error en el proceso OCR:", error);
    return {
      fecha: "Error",
      ruc: "Error",
      razonSocial: "Error",
      totalPagado: "Error"
    };
  }
}

// Escucha cuando se comparte un archivo
app.event('file_shared', async ({ event, client, logger }) => {
  try {
    const fileId = event.file_id;
    
    // 1. Obtener información del archivo para sacar la URL privada
    const fileInfo = await client.files.info({
      file: fileId
    });
    
    const file = fileInfo.file;
    
    // Solo procesamos si es una imagen (factura)
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      const urlPrivada = file.url_private_download;
      
      // 2. Extraer datos (Motor OCR)
      const datosExtraidos = await extraerDatosOCR(urlPrivada, process.env.SLACK_BOT_TOKEN);
      
      // 3. Actualizar el Canvas
      // Necesitas el ID de tu canvas. Lo guardaremos en .env como CANVAS_ID
      const canvasId = process.env.CANVAS_ID;
      
      if (!canvasId || canvasId === 'tu_canvas_id_aqui') {
        logger.warn("⚠️ No se ha definido un CANVAS_ID válido en el archivo .env");
        return;
      }

      // Estructuramos el payload de Markdown como se indica en la arquitectura
      const markdownTable = `| Fecha | RUC | Razón Social | Total Pagado |\n| :--- | :--- | :--- | :--- |\n| ${datosExtraidos.fecha} | ${datosExtraidos.ruc} | ${datosExtraidos.razonSocial} | ${datosExtraidos.totalPagado} |\n`;

      // Llamada al endpoint canvases.edit de Slack
      await client.apiCall('canvases.edit', {
        canvas_id: canvasId,
        changes: [
          {
            operation: "insert_at_end",
            document_content: {
              type: "markdown",
              markdown: markdownTable
            }
          }
        ]
      });
      
      console.log(`✅ Canvas ${canvasId} actualizado con los datos de la factura.`);
    }

  } catch (error) {
    logger.error("Error en el flujo de OCR a Canvas:", error);
  }
});

// ==========================================
// FLUJO: REPORTE DE SINIESTROS / PROBLEMA PROTOCOLO
// ==========================================

// 1. Escuchar el mensaje detonante
app.message(/problema protocolo/i, async ({ message, say, client, logger }) => {
  try {
    // Verificar si hay archivos adjuntos (la foto de la evidencia)
    const hasFiles = message.files && message.files.length > 0;
    
    // Extraer menciones de usuarios (el supervisor)
    // El texto podría ser: "Problema protocolo en ruta @supervisor"
    let supervisorId = null;
    const userMatch = message.text.match(/<@([a-zA-Z0-9]+)(\|.+)?>/);
    if (userMatch) {
      supervisorId = userMatch[1];
    }

    if (!supervisorId) {
      await say({
        text: `⚠️ <@${message.user}>, para reportar un problema de protocolo debes etiquetar a un supervisor (ejemplo: \`@Juan Perez\`).`,
        thread_ts: message.ts
      });
      return;
    }

    if (!hasFiles) {
      await say({
        text: `⚠️ <@${message.user}>, recuerda adjuntar una foto de evidencia en el mensaje para el reporte de protocolo.`,
        thread_ts: message.ts
      });
      return;
    }

    // Obtener la URL de la primera imagen
    const fileUrl = message.files[0].url_private;
    
    // Guardar los datos temporalmente para pasarlos al modal
    const metadata = JSON.stringify({
      sup: supervisorId,
      url: fileUrl,
      msg_ts: message.ts,
      channel: message.channel
    });

    // Enviar botón para abrir el formulario en un hilo
    await say({
      thread_ts: message.ts,
      text: `Alerta de protocolo detectada. Por favor, llena el formulario de reporte.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🚨 *¡Alerta Detectada!*\n<@${message.user}>, haz clic en el botón para completar el formulario del siniestro. Se enviará directamente a <@${supervisorId}>.`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "📝 Llenar Reporte",
                emoji: true
              },
              style: "danger",
              action_id: "abrir_modal_siniestro",
              value: metadata // Guardamos la info aquí para recuperarla al hacer clic
            }
          ]
        }
      ]
    });

  } catch (error) {
    logger.error("Error en flujo de problema protocolo:", error);
  }
});

// 2. Abrir el modal cuando hacen clic en el botón
app.action('abrir_modal_siniestro', async ({ body, ack, client, logger }) => {
  await ack();
  
  const metadata = body.actions[0].value;

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'modal_siniestro',
        private_metadata: metadata,
        title: {
          type: 'plain_text',
          text: 'Reporte de Siniestro'
        },
        submit: {
          type: 'plain_text',
          text: 'Enviar Reporte'
        },
        close: {
          type: 'plain_text',
          text: 'Cancelar'
        },
        blocks: [
          {
            type: 'input',
            block_id: 'bloque_tipo',
            element: {
              type: 'static_select',
              action_id: 'input_tipo',
              placeholder: { type: 'plain_text', text: 'Selecciona el tipo de siniestro' },
              options: [
                { text: { type: 'plain_text', text: '🚨 Robo' }, value: 'Robo' },
                { text: { type: 'plain_text', text: '💥 Accidente' }, value: 'Accidente' },
                { text: { type: 'plain_text', text: '⚠️ Falla de Protocolo' }, value: 'Falla Protocolo' },
                { text: { type: 'plain_text', text: '📦 Mercadería Dañada' }, value: 'Mercadería Dañada' }
              ]
            },
            label: { type: 'plain_text', text: 'Tipo de Siniestro' }
          },
          {
            type: 'input',
            block_id: 'bloque_partida',
            element: { type: 'plain_text_input', action_id: 'input_partida' },
            label: { type: 'plain_text', text: 'Lugar de Partida' }
          },
          {
            type: 'input',
            block_id: 'bloque_destino',
            element: { type: 'plain_text_input', action_id: 'input_destino' },
            label: { type: 'plain_text', text: 'Lugar de Destino' }
          },
          {
            type: 'input',
            block_id: 'bloque_detalles',
            element: { type: 'plain_text_input', action_id: 'input_detalles', multiline: true },
            label: { type: 'plain_text', text: 'Detalles del Siniestro / Situación inicial' }
          },
          {
            type: 'input',
            block_id: 'bloque_productos',
            element: { type: 'plain_text_input', action_id: 'input_productos', multiline: true },
            label: { type: 'plain_text', text: 'Descripción de la entrega y productos' }
          },
          {
            type: 'input',
            block_id: 'bloque_rep1',
            element: { type: 'plain_text_input', action_id: 'input_rep1', placeholder: { type: 'plain_text', text: 'DNI y Nombres Completos' } },
            label: { type: 'plain_text', text: 'Repartidor Principal' }
          },
          {
            type: 'input',
            block_id: 'bloque_rep2',
            optional: true,
            element: { type: 'plain_text_input', action_id: 'input_rep2', placeholder: { type: 'plain_text', text: 'DNI y Nombres Completos' } },
            label: { type: 'plain_text', text: 'Segundo Repartidor (Opcional)' }
          }
        ]
      }
    });
  } catch (error) {
    logger.error("Error abriendo el modal de siniestro:", error);
  }
});

// 3. Manejar el envío del modal y enviar DM al supervisor
app.view('modal_siniestro', async ({ ack, body, view, client, logger }) => {
  await ack();

  try {
    const values = view.state.values;
    const tipo = values.bloque_tipo.input_tipo.selected_option.value;
    const partida = values.bloque_partida.input_partida.value;
    const destino = values.bloque_destino.input_destino.value;
    const detalles = values.bloque_detalles.input_detalles.value;
    const productos = values.bloque_productos.input_productos.value;
    const rep1 = values.bloque_rep1.input_rep1.value;
    const rep2 = values.bloque_rep2.input_rep2 ? values.bloque_rep2.input_rep2.value : 'No asignado';
    
    // Recuperar metadata guardada
    const meta = JSON.parse(view.private_metadata);
    const reporterId = body.user.id;

    // Crear un link al mensaje original en el canal
    let permalink = "";
    try {
      const linkRes = await client.chat.getPermalink({ channel: meta.channel, message_ts: meta.msg_ts });
      if (linkRes.ok) permalink = linkRes.permalink;
    } catch (e) {
      // Ignore
    }

    // Mensaje para el supervisor (DM)
    await client.chat.postMessage({
      channel: meta.sup,
      text: `🚨 Nuevo Reporte de Siniestro de <@${reporterId}>`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `🚨 Reporte de Siniestro: ${tipo}`, emoji: true }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Reportado por:* <@${reporterId}>\n*Mensaje Original:* <${permalink}|Ver en el canal> (o <${meta.url}|ver foto adjunta>)`
          }
        },
        { type: "divider" },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*📍 Partida:*\n${partida}` },
            { type: "mrkdwn", text: `*🏁 Destino:*\n${destino}` },
            { type: "mrkdwn", text: `*👤 Repartidor 1:*\n${rep1}` },
            { type: "mrkdwn", text: `*👥 Repartidor 2:*\n${rep2 || 'No asignado'}` }
          ]
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*📝 Detalles de lo ocurrido:*\n> ${detalles}` }
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*📦 Productos involucrados:*\n> ${productos}` }
        }
      ]
    });

    // Confirmar al repartidor en el hilo original
    await client.chat.postMessage({
      channel: meta.channel,
      thread_ts: meta.msg_ts,
      text: `✅ <@${reporterId}> tu reporte de siniestro ha sido enviado exitosamente a <@${meta.sup}>.`
    });

  } catch (error) {
    logger.error("Error procesando modal de siniestro:", error);
  }
});

// ==========================================
// FLUJO B2B: APROBACIÓN DE DESCUENTOS Y CRÉDITOS
// ==========================================

// 1. Comando para abrir el modal de solicitud
app.command('/solicitar-descuento', async ({ command, ack, client, logger }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'modal_b2b_descuento',
        title: { type: 'plain_text', text: 'Solicitud de Descuento' },
        submit: { type: 'plain_text', text: 'Enviar al Gerente' },
        close: { type: 'plain_text', text: 'Cancelar' },
        blocks: [
          {
            type: 'input',
            block_id: 'bloque_cliente',
            element: { type: 'plain_text_input', action_id: 'input_cliente', placeholder: { type: 'plain_text', text: 'Constructora XYZ S.A.C.' } },
            label: { type: 'plain_text', text: 'Cliente' }
          },
          {
            type: 'input',
            block_id: 'bloque_pedido',
            element: { type: 'plain_text_input', action_id: 'input_pedido', placeholder: { type: 'plain_text', text: 'Ej: 5,000 m2 o S/ 150,000' } },
            label: { type: 'plain_text', text: 'Volumen o Monto del Pedido' }
          },
          {
            type: 'input',
            block_id: 'bloque_descuento',
            element: { type: 'plain_text_input', action_id: 'input_descuento', placeholder: { type: 'plain_text', text: 'Ej: 8%' } },
            label: { type: 'plain_text', text: 'Descuento Adicional Solicitado' }
          },
          {
            type: 'input',
            block_id: 'bloque_justificacion',
            element: { type: 'plain_text_input', action_id: 'input_justificacion', multiline: true, placeholder: { type: 'plain_text', text: 'Igualar oferta de la competencia...' } },
            label: { type: 'plain_text', text: 'Justificación Estratégica' }
          },
          {
            type: 'input',
            block_id: 'bloque_gerente',
            element: {
              type: 'users_select',
              action_id: 'input_gerente',
              placeholder: { type: 'plain_text', text: 'Selecciona al Gerente Comercial' }
            },
            label: { type: 'plain_text', text: 'Enviar aprobación a' }
          }
        ]
      }
    });
  } catch (error) {
    logger.error("Error abriendo modal de descuento:", error);
  }
});

// 2. Procesar el formulario y enviar la tarjeta interactiva al gerente
app.view('modal_b2b_descuento', async ({ ack, body, view, client, logger }) => {
  await ack();
  try {
    const values = view.state.values;
    const cliente = values.bloque_cliente.input_cliente.value;
    const pedido = values.bloque_pedido.input_pedido.value;
    const descuento = values.bloque_descuento.input_descuento.value;
    const justificacion = values.bloque_justificacion.input_justificacion.value;
    const gerenteId = values.bloque_gerente.input_gerente.selected_user;
    
    const vendedorId = body.user.id;

    // Generamos un string con los datos en formato JSON para pasarlo a los botones
    const requestData = JSON.stringify({
      vendedor: vendedorId,
      cliente: cliente,
      pedido: pedido,
      descuento: descuento
    });

    // Enviar DM al gerente
    await client.chat.postMessage({
      channel: gerenteId,
      text: `🚨 Tienes una nueva solicitud de descuento B2B de <@${vendedorId}>`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `💸 Solicitud de Descuento B2B`, emoji: true }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Vendedor:* <@${vendedorId}>\n*Cliente:* ${cliente}\n*Pedido:* ${pedido}\n*Descuento Solicitado:* ${descuento}\n\n*Justificación:*\n> ${justificacion}`
          }
        },
        { type: "divider" },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "✅ Aprobar", emoji: true },
              style: "primary",
              action_id: "b2b_aprobar",
              value: requestData
            },
            {
              type: "button",
              text: { type: "plain_text", text: "❌ Rechazar", emoji: true },
              style: "danger",
              action_id: "b2b_rechazar",
              value: requestData
            },
            {
              type: "button",
              text: { type: "plain_text", text: "💬 Pedir más datos", emoji: true },
              action_id: "b2b_mas_datos",
              value: requestData
            }
          ]
        }
      ]
    });

    // Avisar al vendedor (opcional, como un DM automatizado)
    await client.chat.postMessage({
      channel: vendedorId,
      text: `✅ Tu solicitud de descuento para *${cliente}* ha sido enviada a <@${gerenteId}> para su revisión.`
    });

  } catch (error) {
    logger.error("Error enviando reporte B2B:", error);
  }
});

// 3. Manejar las acciones de los botones del gerente
app.action(/b2b_(aprobar|rechazar|mas_datos)/, async ({ action, body, ack, client, logger }) => {
  await ack();
  try {
    const decisionType = action.action_id; // 'b2b_aprobar', 'b2b_rechazar' o 'b2b_mas_datos'
    const requestData = JSON.parse(action.value);
    const gerenteId = body.user.id;

    // Actualizar el mensaje del gerente para que los botones desaparezcan
    let nuevoTexto = "";
    let colorTexto = "";
    if (decisionType === 'b2b_aprobar') {
      nuevoTexto = "✅ *Aprobaste* esta solicitud.";
      colorTexto = "🟢";
    } else if (decisionType === 'b2b_rechazar') {
      nuevoTexto = "❌ *Rechazaste* esta solicitud.";
      colorTexto = "🔴";
    } else {
      nuevoTexto = "💬 *Pediste más datos* (te pondrás en contacto con el vendedor).";
      colorTexto = "🟡";
    }

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `Solicitud procesada: ${nuevoTexto}`,
      blocks: [
        body.message.blocks[0], // Header
        body.message.blocks[1], // Detalles
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${colorTexto} ${nuevoTexto} (Se ha notificado al vendedor)`
          }
        }
      ]
    });

    // Notificar al vendedor
    let notificacionVendedor = "";
    if (decisionType === 'b2b_aprobar') {
      notificacionVendedor = `🎉 *¡Aprobado!* <@${gerenteId}> aprobó el descuento de *${requestData.descuento}* para *${requestData.cliente}*. (Simulación: Integración con ERP activada y pedido actualizado).`;
    } else if (decisionType === 'b2b_rechazar') {
      notificacionVendedor = `❌ *Rechazado.* <@${gerenteId}> rechazó la solicitud para *${requestData.cliente}*.`;
    } else {
      notificacionVendedor = `⚠️ *Revisión pendiente.* <@${gerenteId}> necesita más datos para evaluar el caso de *${requestData.cliente}*. Te contactará en breve.`;
    }

    await client.chat.postMessage({
      channel: requestData.vendedor,
      text: notificacionVendedor
    });

  } catch (error) {
    logger.error("Error manejando acción B2B:", error);
  }
});

// ==========================================
// FLUJO: DEMO AGENTE DE IA (CELIMA BOT)
// ==========================================

app.command('/celima-bot', async ({ command, ack, respond, client, logger }) => {
  await ack();

  const pregunta = command.text.trim().toLowerCase();
  
  if (!pregunta || pregunta === 'iniciar') {
    await respond("👋 ¡Hola! Soy Celima Bot. Puedes preguntarme sobre stock, proyecciones o riesgos operativos.");
    return;
  }

  try {
    // 1. Mensaje inicial simulando "Pensamiento"
    const thinkingMessage = await client.chat.postMessage({
      channel: command.channel_id,
      text: `🪄 *Celima Bot está analizando...* \n> _Consultando ERP y cruzando datos de demanda en tiempo real para: "${command.text}"_`
    });

    // 2. Simular un tiempo de procesamiento de 2.5 segundos
    setTimeout(async () => {
      let blocks = [];
      let textResponse = "";

      // ESCENARIO A: Consulta de Stock
      if (pregunta.includes("stock") || pregunta.includes("carrara")) {
        textResponse = "Reporte de Inventario: Porcelanato Carrara 60x60";
        blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: "📊 Reporte de Inventario: Porcelanato Carrara 60x60", emoji: true }
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: "*🏢 Almacén Lima:*\n🟢 18,240 m²\n_(Saludable)_" },
              { type: "mrkdwn", text: "*🏢 Almacén Trujillo:*\n🟡 2,890 m²\n_(Reposición: Viernes)_" }
            ]
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: "*🏢 Almacén Arequipa:*\n🔴 4,320 m²\n_(Alerta de quiebre inminente)_" }
            ]
          },
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: "💡 *Insight AI:* El stock en Arequipa bajó un 15% más rápido de lo proyectado esta semana." }
            ]
          }
        ];
      }
      // ESCENARIO B: Consulta de Riesgo de Quiebre
      else if (pregunta.includes("riesgo") || pregunta.includes("quiebre")) {
        textResponse = "Alerta de Riesgo de Quiebre Detectada";
        blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: "⚠️ Análisis de Riesgo Predictivo", emoji: true }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "He detectado una anomalía. Según el ritmo de ventas actual y las obras confirmadas de la Constructora ABC, **Arequipa sufrirá un quiebre de stock el día Jueves**."
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Solución Recomendada (AI):*\nTrasladar 2,000 m² de exceso desde Lima hacia Arequipa hoy mismo para cubrir la cuota de la semana."
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "🚚 Autorizar Traslado Lima -> Arequipa", emoji: true },
                style: "primary",
                action_id: "accion_traslado_kanalia"
              }
            ]
          }
        ];
      }
      // ESCENARIO C: Cualquier otra pregunta
      else {
        textResponse = "Respuesta de Celima Bot";
        blocks = [
          {
            type: "section",
            text: { type: "mrkdwn", text: `🤖 He analizado tu consulta sobre *"${command.text}"*.\nActualmente puedo ayudarte a consultar niveles de inventario específicos o predecir riesgos operativos. Intenta preguntarme: _"¿Cuánto stock tenemos de Carrara 60x60?"_` }
          }
        ];
      }

      // 3. Actualizar el mensaje original con la respuesta final
      await client.chat.update({
        channel: command.channel_id,
        ts: thinkingMessage.ts,
        text: textResponse,
        blocks: blocks
      });

    }, 2500); // 2.5 segundos de delay

  } catch (error) {
    logger.error("Error en comando Celima Bot:", error);
  }
});

// 4. Manejador del botón de traslado
app.action('accion_traslado_kanalia', async ({ body, ack, client, logger }) => {
  await ack();
  try {
    // Actualizar el mensaje para mostrar éxito
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: "Traslado en proceso",
      blocks: [
        body.message.blocks[0], // Header
        body.message.blocks[1], // Contexto de riesgo
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "✅ *¡Ejecución Automática Exitosa!*\n> Orden de Traslado `#TR-9983` (2,000 m²) generada automáticamente en el ERP (SAP). \n> 🚛 El camión T-45 sale de Lima hoy a las 18:00 hrs. El gerente de logística ha sido notificado."
          }
        }
      ]
    });
  } catch (error) {
    logger.error("Error en botón de traslado:", error);
  }
});

// ==========================================
// FLUJO: ALERTAS DE CADENA DE SUMINISTRO Y PRODUCCIÓN
// ==========================================

// 1. Comando simulador de SAP/IoT
app.command('/simular-alerta-sap', async ({ command, ack, client, logger }) => {
  await ack();
  try {
    await client.chat.postMessage({
      channel: command.channel_id,
      text: "🚨 ALERTA CRÍTICA: Parada de Máquina",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "🚨 ALERTA SAP/IoT: Parada de Máquina", emoji: true }
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: "*Línea de Producción:*\nExtrusión 04" },
            { type: "mrkdwn", text: "*Tiempo de inactividad:*\n00:03:12 (En aumento)" },
            { type: "mrkdwn", text: "*Impacto Financiero:*\n📉 -$1,200 / hora" },
            { type: "mrkdwn", text: "*Diagnóstico IoT:*\n⚠️ Caída de presión hidráulica (Sensor H-42)" }
          ]
        },
        { type: "divider" },
        {
          type: "section",
          text: { type: "mrkdwn", text: "La línea se encuentra detenida. Requiere atención inmediata por mantenimiento." }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "🔧 Asumir Incidencia", emoji: true },
              style: "primary",
              action_id: "asumir_incidencia_planta"
            },
            {
              type: "button",
              text: { type: "plain_text", text: "📦 Pedir Repuesto", emoji: true },
              action_id: "pedir_repuesto_planta"
            }
          ]
        }
      ]
    });
  } catch (error) {
    logger.error("Error simulando alerta SAP:", error);
  }
});

// 2. Acción: Asumir Incidencia
app.action('asumir_incidencia_planta', async ({ body, ack, client, logger }) => {
  await ack();
  try {
    const userId = body.user.id;
    // Quitamos los botones y mostramos quién asumió la incidencia
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: "Incidencia asumida",
      blocks: [
        body.message.blocks[0], // Header
        body.message.blocks[1], // Detalles
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ *En Atención:* El ingeniero <@${userId}> ha asumido esta incidencia y se encuentra en camino a la Máquina de Extrusión 04.`
          }
        }
      ]
    });
  } catch (error) {
    logger.error("Error asumiendo incidencia de planta:", error);
  }
});

// 3. Acción: Pedir Repuesto (Abre Modal)
app.action('pedir_repuesto_planta', async ({ body, ack, client, logger }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'modal_repuesto_planta',
        private_metadata: JSON.stringify({ channel: body.channel.id, ts: body.message.ts }),
        title: { type: 'plain_text', text: 'Solicitud a Almacén' },
        submit: { type: 'plain_text', text: 'Solicitar Pieza' },
        close: { type: 'plain_text', text: 'Cancelar' },
        blocks: [
          {
            type: 'input',
            block_id: 'bloque_codigo',
            element: { type: 'plain_text_input', action_id: 'input_codigo', placeholder: { type: 'plain_text', text: 'Ej: Válvula Hidráulica V-700' } },
            label: { type: 'plain_text', text: 'Código o Nombre del Repuesto' }
          },
          {
            type: 'input',
            block_id: 'bloque_urgencia',
            element: {
              type: 'static_select',
              action_id: 'input_urgencia',
              placeholder: { type: 'plain_text', text: 'Seleccionar nivel' },
              options: [
                { text: { type: 'plain_text', text: '🚨 Crítica (Línea Parada)' }, value: 'critica' },
                { text: { type: 'plain_text', text: '🟡 Media (Mantenimiento)' }, value: 'media' }
              ]
            },
            label: { type: 'plain_text', text: 'Nivel de Urgencia' }
          }
        ]
      }
    });
  } catch (error) {
    logger.error("Error abriendo modal de repuesto:", error);
  }
});

// 4. Manejar el envío del Modal de Repuesto
app.view('modal_repuesto_planta', async ({ ack, body, view, client, logger }) => {
  await ack();
  try {
    const values = view.state.values;
    const repuesto = values.bloque_codigo.input_codigo.value;
    const urgencia = values.bloque_urgencia.input_urgencia.selected_option.value;
    const userId = body.user.id;
    const meta = JSON.parse(view.private_metadata);

    // Responder en el hilo del mensaje de alerta original
    await client.chat.postMessage({
      channel: meta.channel,
      thread_ts: meta.ts,
      text: `📦 *Solicitud a Almacén generada por <@${userId}>:*\nSe ha solicitado la pieza: *${repuesto}*.\nEstado del almacén: _Procesando despacho urgente hacia Extrusión 04._`
    });

  } catch (error) {
    logger.error("Error procesando modal de repuesto:", error);
  }
});

// ==========================================
// FLUJO: PREDICCIÓN DE FUGA B2B (AJINOMOTO / KAM)
// ==========================================

// 1. Comando para simular la alerta predictiva de churn
app.command('/simular-alerta-fuga', async ({ command, ack, client, logger }) => {
  await ack();
  try {
    await client.chat.postMessage({
      channel: command.channel_id,
      text: "📉 Alerta Predictiva de Fuga (Churn Model)",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "🤖 Alerta Predictiva (Modelo de Churn)", emoji: true }
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: "*Distribuidor:*\nMayorista 'El Norteño' (Cono Norte)" },
            { type: "mrkdwn", text: "*Categoría de Riesgo:*\n🔴 ALTO (82% prob. de fuga)" }
          ]
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Análisis de la IA:*\nEl cliente ha bajado sus pedidos de _Aji-no-men_ en un **15%** durante el último mes, mientras que sus compras de la competencia (marca X) han aumentado en esa misma zona geográfica. \n\n*Sugerencia del sistema:* Intervención comercial inmediata."
          }
        },
        { type: "divider" },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "📅 Programar Visita Urgente", emoji: true },
              style: "primary",
              action_id: "programar_visita_kam"
            },
            {
              type: "button",
              text: { type: "plain_text", text: "🎁 Aplicar Bono de Retención", emoji: true },
              action_id: "bono_fidelizacion_kam"
            }
          ]
        }
      ]
    });
  } catch (error) {
    logger.error("Error simulando alerta de fuga:", error);
  }
});

// 2. Acción: Programar Visita (Abre Modal)
app.action('programar_visita_kam', async ({ body, ack, client, logger }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'modal_visita_kam',
        private_metadata: JSON.stringify({ channel: body.channel.id, ts: body.message.ts }),
        title: { type: 'plain_text', text: 'Programar Visita B2B' },
        submit: { type: 'plain_text', text: 'Agendar en CRM' },
        close: { type: 'plain_text', text: 'Cancelar' },
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: 'Agendando visita presencial para *Mayorista El Norteño*.' }
          },
          {
            type: 'input',
            block_id: 'bloque_fecha_visita',
            element: {
              type: 'datepicker',
              initial_date: new Date().toISOString().split('T')[0],
              action_id: 'input_fecha_visita'
            },
            label: { type: 'plain_text', text: 'Fecha de la visita' }
          },
          {
            type: 'input',
            block_id: 'bloque_objetivo',
            element: { type: 'plain_text_input', action_id: 'input_objetivo', multiline: true, placeholder: { type: 'plain_text', text: 'Ej: Presentar nueva oferta de volumen y entender motivo de la baja...' } },
            label: { type: 'plain_text', text: 'Objetivo de la reunión' }
          }
        ]
      }
    });
  } catch (error) {
    logger.error("Error abriendo modal de visita:", error);
  }
});

// 3. Manejar el envío del Modal de Visita
app.view('modal_visita_kam', async ({ ack, body, view, client, logger }) => {
  await ack();
  try {
    const values = view.state.values;
    const fecha = values.bloque_fecha_visita.input_fecha_visita.selected_date;
    const objetivo = values.bloque_objetivo.input_objetivo.value;
    const userId = body.user.id;
    const meta = JSON.parse(view.private_metadata);

    // Responder en el canal original (o en un hilo)
    await client.chat.postMessage({
      channel: meta.channel,
      thread_ts: meta.ts,
      text: `✅ *CRM Actualizado por <@${userId}>:*\nSe ha agendado una visita a *El Norteño* para el *${fecha}*.\n*Objetivo:* ${objetivo}`
    });

  } catch (error) {
    logger.error("Error procesando modal de visita:", error);
  }
});

// 4. Acción: Aplicar Bono de Fidelización
app.action('bono_fidelizacion_kam', async ({ body, ack, client, logger }) => {
  await ack();
  try {
    // Actualizar el mensaje para mostrar el éxito de la acción
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: "Incentivo aplicado",
      blocks: [
        body.message.blocks[0], // Header
        body.message.blocks[1], // Campos
        body.message.blocks[2], // Análisis AI
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🎁 *Acción Inmediata:* <@${body.user.id}> ha autorizado un *Descuento Especial de Retención (5%)* para el próximo pedido en SAP. Notificación automática enviada al cliente.`
          }
        }
      ]
    });
  } catch (error) {
    logger.error("Error aplicando bono de retención:", error);
  }
});