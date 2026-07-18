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
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('El bot de Slack está ejecutándose en Socket Mode.');
}).listen(port, () => {
  console.log(`Servidor HTTP de respaldo escuchando en el puerto ${port} para Render`);
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