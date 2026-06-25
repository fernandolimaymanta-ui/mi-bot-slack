require('dotenv').config();
const { App } = require('@slack/bolt');

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

// ... (tu configuración inicial y app.message quedan arriba) ...

// Escucha el comando /predecir-churn
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

// ... (tu app.start() queda abajo) ...