require('dotenv').config();
const { Boom } = require('@hapi/boom');
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const makeWASocket = require('@whiskeysockets/baileys').default;
const cloudinary = require('cloudinary').v2;
const qrcode = require('qrcode');
const fs = require('fs').promises;

// Configurar Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Objeto para rastrear el estado de la conversación por usuario
const estadosConversacion = {};

// Tiempo de espera: 5 minutos en milisegundos
const TIMEOUT_MINUTES = 5;
const TIMEOUT_MS = TIMEOUT_MINUTES * 60 * 1000;

// Función para configurar o reiniciar el temporizador de un usuario
function setTimeoutForUser(remitente) {
    const estado = estadosConversacion[remitente];

    // No hacer nada si no hay estado (conversación finalizada)
    if (!estado) {
        console.log(`No se configura temporizador para ${remitente}: estado no existe`);
        return;
    }

    // Limpiar cualquier temporizador existente
    if (estado.timeoutId) {
        clearTimeout(estado.timeoutId);
        estado.timeoutId = null;
        console.log(`Temporizador anterior limpiado para ${remitente}`);
    }

    // Configurar nuevo temporizador solo si no está en con_asesor
    if (estado.nivel !== "con_asesor") {
        estado.timeoutId = setTimeout(async () => {
            try {
                await sock.sendMessage(remitente, { text: "Han pasado 5 minutos sin respuesta. La conversación ha expirada. Escribe 'hola' para empezar de nuevo." });
                delete estadosConversacion[remitente];
                console.log(`Conversación expirada para ${remitente}`);
            } catch (error) {
                console.error('Error en timeout:', error);
            }
        }, TIMEOUT_MS);
        console.log(`Temporizador configurado para ${remitente}`);
    }
}

// Funciones de texto para menús
const menus = {
    terminos: `¡Hola! 👋 ¡Bienvenid@! Gracias por ponerte en contacto con nosotros. Antes de iniciar, es necesario que aceptes los términos y condiciones de EstoEsPamii. Si quieres conocer más, ingresa aquí: https://estoespamii.co/www/tycclientes2024.html
    \nPara continuar elige:
    \n1. Acepto
    \n2. No acepto`,
    principal: `¡Hola! 👋 ¡Bienvenid@ a EstoEsPamii! Soy tu asistente virtual, list@ para darte una mano. 😉  
    \nElige una opción:
    \n1. Chatear con un asesor
    \n2. ¿Cómo va mi pedido?
    \n3. Reclamos/Devoluciones
    \n4. ¡Chao!
    \nIngresa el número. 👇`,
    asesor: `¡Genial! 😉 ¿Sobre qué necesitas ayuda? Elige una categoría:
    \n1. Quiero comprar / Ver productos
    \n2. Ayuda con mis compras
    \n3. Volver al inicio`,
    pedido: `Seleccione una opción:
    \n1. Consultar por número de pedido 🔍
    \n2. Consultar pedidos recientes 📋
    \n3. Volver al menú principal ⬅️`,
    reclamos: `Seleccione una opción:
    \n1. Registrar un nuevo reclamo ✍️
    \n2. Consultar estado de un reclamo 📊
    \n3. Solicitar devolución 🔙
    \n4. Volver al menú principal ⬅️`,
};

// Función auxiliar para extraer texto del mensaje
function extractText(message) {
    if (message.message.conversation) {
        return message.message.conversation;
    } else if (message.message.extendedTextMessage?.text) {
        return message.message.extendedTextMessage.text;
    }
    return '';
}

// Definición de los handlers para cada etapa
const stageHandlers = {
    inicio: async (message, estado) => {
        try {
            await sock.sendMessage(message.key.remoteJid, { text: menus.terminos });
            estadosConversacion[message.key.remoteJid] = { nivel: "terminos", timeoutId: null };
            console.log('Estado inicial:', estadosConversacion[message.key.remoteJid]);
        } catch (error) {
            console.error('Error en inicio:', error);
        }
    },
    terminos: async (message, estado) => {
        const opcion = extractText(message).trim().replace(/\s+/g, '');
        console.log('Opción en terminos:', opcion);
        const opciones = {
            "1": { nivel: "principal", respuesta: menus.principal },
            "2": { nivel: null, respuesta: "Acepta los términos y condiciones para continuar" },
        };
        const seleccion = opciones[opcion] || { respuesta: "Opción no válida. Selecciona 1 para aceptar o 2 para rechazar." };
        try {
            await sock.sendMessage(message.key.remoteJid, { text: seleccion.respuesta });
            console.log('Mensaje enviado en terminos:', seleccion.respuesta);
            if (seleccion.nivel === null) {
                // Limpiar temporizador antes de eliminar estado
                if (estado.timeoutId) {
                    clearTimeout(estado.timeoutId);
                    console.log(`Temporizador limpiado para ${message.key.remoteJid} en terminos`);
                }
                delete estadosConversacion[message.key.remoteJid];
                console.log('Estado eliminado:', message.key.remoteJid);
            } else if (seleccion.nivel) {
                estadosConversacion[message.key.remoteJid] = { nivel: seleccion.nivel, timeoutId: null };
                console.log('Estado actualizado:', estadosConversacion[message.key.remoteJid]);
            }
        } catch (error) {
            console.error('Error en terminos:', error);
        }
    },
    principal: async (message, estado) => {
        const opcion = extractText(message).trim().replace(/\s+/g, '');
        console.log('Opción en principal:', opcion);
        const opciones = {
            "1": { nivel: "asesor", respuesta: menus.asesor },
            "2": { nivel: "pedido", respuesta: menus.pedido },
            "3": { nivel: "reclamos", respuesta: menus.reclamos },
            "4": { nivel: null, respuesta: "Conversación finalizada. Escribe 'hola' para iniciar de nuevo." },
        };
        const seleccion = opciones[opcion] || { respuesta: "Opción no válida. Seleccione un número del 1 al 4." };
        try {
            await sock.sendMessage(message.key.remoteJid, { text: seleccion.respuesta });
            console.log('Mensaje enviado en principal:', seleccion.respuesta);
            if (seleccion.nivel === null) {
                // Limpiar temporizador antes de eliminar estado
                if (estado.timeoutId) {
                    clearTimeout(estado.timeoutId);
                    console.log(`Temporizador limpiado para ${message.key.remoteJid} antes de eliminar estado`);
                }
                delete estadosConversacion[message.key.remoteJid];
                console.log('Estado eliminado:', message.key.remoteJid);
            } else if (seleccion.nivel) {
                estado.nivel = seleccion.nivel;
                console.log('Estado actualizado:', estadosConversacion[message.key.remoteJid]);
            }
        } catch (error) {
            console.error('Error en principal:', error);
        }
    },
    asesor: async (message, estado) => {
        const opcion = extractText(message).trim().replace(/\s+/g, '');
        console.log('Opción en asesor:', opcion);
        const opciones = {
            "1": { nivel: "con_asesor", tipo: "ventas", respuesta: "¡Ok! 😉 Un asesor de Ventas y Productos te contactará en breve." },
            "2": { nivel: "con_asesor", tipo: "soporte", respuesta: "¡Ok! 😉 Un asesor de Soporte Técnico te contactará en breve." },
            "3": { nivel: "principal", respuesta: menus.principal },
        };
        const seleccion = opciones[opcion] || { respuesta: "Opción no válida. Seleccione un número del 1 al 3." };
        try {
            await sock.sendMessage(message.key.remoteJid, { text: seleccion.respuesta });
            console.log('Mensaje enviado en asesor:', seleccion.respuesta);
            if (seleccion.nivel) {
                estado.nivel = seleccion.nivel;
                if (seleccion.tipo) estado.tipo = seleccion.tipo;
                console.log('Estado actualizado:', estadosConversacion[message.key.remoteJid]);
            }
        } catch (error) {
            console.error('Error en asesor:', error);
        }
    },
    pedido: async (message, estado) => {
        const opcion = extractText(message).trim().replace(/\s+/g, '');
        console.log('Opción en pedido:', opcion);
        const opciones = {
            "1": { nivel: "esperando_numero_pedido", respuesta: "Por favor, indique el número de su pedido." },
            "2": { nivel: "pedido", respuesta: ["Consultando sus pedidos recientes... Un momento, por favor.", "No hay pedidos recientes registrados. Si desea, indique un número de pedido específico."] },
            "3": { nivel: "principal", respuesta: menus.principal },
        };
        const seleccion = opciones[opcion] || { respuesta: "Opción no válida. Seleccione un número del 1 al 3." };
        try {
            if (Array.isArray(seleccion.respuesta)) {
                for (const msg of seleccion.respuesta) {
                    await sock.sendMessage(message.key.remoteJid, { text: msg });
                    console.log('Mensaje enviado en pedido:', msg);
                }
            } else {
                await sock.sendMessage(message.key.remoteJid, { text: seleccion.respuesta });
                console.log('Mensaje enviado en pedido:', seleccion.respuesta);
            }
            if (seleccion.nivel) {
                estado.nivel = seleccion.nivel;
                console.log('Estado actualizado:', estadosConversacion[message.key.remoteJid]);
            }
        } catch (error) {
            console.error('Error en pedido:', error);
        }
    },
    esperando_numero_pedido: async (message, estado) => {
        const numeroPedido = extractText(message).trim();
        try {
            await sock.sendMessage(message.key.remoteJid, { text: `Gracias. Su pedido es el #${numeroPedido}.` });
            await sock.sendMessage(message.key.remoteJid, { text: "Un asesor está revisando el estado de su pedido. Por favor, espere un momento." });
            console.log('Mensajes enviados en esperando_numero_pedido');
            estado.nivel = "con_asesor";
            estado.tipo = "pedido";
            console.log('Estado actualizado:', estadosConversacion[message.key.remoteJid]);
        } catch (error) {
            console.error('Error en esperando_numero_pedido:', error);
        }
    },
    reclamos: async (message, estado) => {
        const opcion = extractText(message).trim().replace(/\s+/g, '');
        console.log('Opción en reclamos:', opcion);
        const opciones = {
            "1": { nivel: "esperando_descripcion_reclamo", respuesta: "Por favor, describa brevemente su reclamo." },
            "2": { nivel: "esperando_numero_reclamo", respuesta: "Por favor, indique el número de su reclamo." },
            "3": { nivel: "esperando_numero_devolucion", respuesta: "Por favor, indique el número de pedido para la devolución." },
            "4": { nivel: "principal", respuesta: menus.principal },
        };
        const seleccion = opciones[opcion] || { respuesta: "Opción no válida. Seleccione un número del 1 al 4." };
        try {
            await sock.sendMessage(message.key.remoteJid, { text: seleccion.respuesta });
            console.log('Mensaje enviado en reclamos:', seleccion.respuesta);
            if (seleccion.nivel) {
                estado.nivel = seleccion.nivel;
                console.log('Estado actualizado:', estadosConversacion[message.key.remoteJid]);
            }
        } catch (error) {
            console.error('Error en reclamos:', error);
        }
    },
    esperando_descripcion_reclamo: async (message, estado) => {
        const descripcion = extractText(message).trim();
        try {
            await sock.sendMessage(message.key.remoteJid, { text: `Reclamo registrado: "${descripcion}". Un asesor lo revisará pronto.` });
            console.log('Mensaje enviado en esperando_descripcion_reclamo');
            estado.nivel = "con_asesor";
            estado.tipo = "reclamo";
            console.log('Estado actualizado:', estadosConversacion[message.key.remoteJid]);
        } catch (error) {
            console.error('Error en esperando_descripcion_reclamo:', error);
        }
    },
    esperando_numero_reclamo: async (message, estado) => {
        const numeroReclamo = extractText(message).trim();
        try {
            await sock.sendMessage(message.key.remoteJid, { text: `Gracias. Su reclamo es el #${numeroReclamo}.` });
            await sock.sendMessage(message.key.remoteJid, { text: "Un asesor está revisando el estado de su reclamo. Por favor, espere un momento." });
            console.log('Mensajes enviados en esperando_numero_reclamo');
            estado.nivel = "con_asesor";
            estado.tipo = "reclamo";
            console.log('Estado actualizado:', estadosConversacion[message.key.remoteJid]);
        } catch (error) {
            console.error('Error en esperando_numero_reclamo:', error);
        }
    },
    esperando_numero_devolucion: async (message, estado) => {
        const numeroDevolucion = extractText(message).trim();
        try {
            await sock.sendMessage(message.key.remoteJid, { text: `Solicitud de devolución para el pedido #${numeroDevolucion} registrada. Un asesor lo contactará pronto.` });
            console.log('Mensaje enviado en esperando_numero_devolucion');
            estado.nivel = "con_asesor";
            estado.tipo = "devolucion";
            console.log('Estado actualizado:', estadosConversacion[message.key.remoteJid]);
        } catch (error) {
            console.error('Error en esperando_numero_devolucion:', error);
        }
    },
    con_asesor: async (message, estado) => {
        console.log('Usuario en con_asesor, esperando intervención del asesor');
        // No responde nada, está con un asesor
    },
};

// Conexión con Baileys
let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_state');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                const qrImagePath = './qr-code.png';
                await qrcode.toFile(qrImagePath, qr, {
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF',
                    },
                });
                console.log('QR generado como imagen en:', qrImagePath);

                const result = await cloudinary.uploader.upload(qrImagePath, {
                    folder: 'whatsapp-qr',
                    overwrite: true,
                });
                console.log('Escanea el QR desde este enlace:', result.secure_url);

                await fs.unlink(qrImagePath);
            } catch (error) {
                console.error('Error al generar o subir el QR:', error);
            }
        }

        if (connection === 'open') {
            console.log('¡Pamii-bot conectado a WhatsApp!');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) &&
                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            console.log('Desconectado de WhatsApp:', DisconnectReason[lastDisconnect?.error?.output?.statusCode] || 'Razón desconocida');
            if (shouldReconnect) {
                console.log('Intentando reconectar...');
                await connectToWhatsApp();
            } else {
                console.log('Sesión cerrada. Por favor, elimina la carpeta "auth_state" y escanea el QR de nuevo.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message.message || message.key.fromMe) {
            console.log('Ignorando mensaje:', message);
            return;
        }

        const remitente = message.key.remoteJid;
        const texto = extractText(message).toLowerCase();
        console.log('Mensaje entrante:', JSON.stringify(message, null, 2));
        console.log('Texto extraído:', texto);

        try {
            if (texto === "hola") {
                console.log('Iniciando flujo con "hola"');
                await sock.sendMessage(remitente, { text: menus.terminos });
                estadosConversacion[remitente] = { nivel: "terminos", timeoutId: null };
                setTimeoutForUser(remitente);
                return;
            }

            if (texto === "salir" && estadosConversacion[remitente]) {
                console.log('Saliendo del modo actual');
                // Limpiar temporizador antes de eliminar estado
                if (estadosConversacion[remitente].timeoutId) {
                    clearTimeout(estadosConversacion[remitente].timeoutId);
                    console.log(`Temporizador limpiado para ${remitente} al salir`);
                }
                await sock.sendMessage(remitente, { text: "Has salido del modo actual. Escribe 'hola' para ver el menú." });
                delete estadosConversacion[remitente];
                return;
            }

            if (!estadosConversacion[remitente]) {
                console.log('No hay estado, iniciando flujo');
                await stageHandlers.inicio(message, {});
                setTimeoutForUser(remitente);
                return;
            }

            const estado = estadosConversacion[remitente];
            const handler = stageHandlers[estado.nivel] || stageHandlers.inicio;
            console.log(`Ejecutando handler para nivel: ${estado.nivel}`);
            await handler(message, estado);
            // Solo configurar temporizador si el estado aún existe
            if (estadosConversacion[remitente]) {
                setTimeoutForUser(remitente);
            } else {
                console.log(`No se configura temporizador para ${remitente}: estado eliminado`);
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
            await sock.sendMessage(remitente, { text: 'Ocurrió un error. Por favor, intenta de nuevo.' });
        }
    });
}

// Iniciar la conexión
connectToWhatsApp().catch(err => console.error('Error en la conexión:', err));