require('dotenv').config(); // Cargar variables de entorno
const { Boom } = require('@hapi/boom');
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const makeWASocket = require('@whiskeysockets/baileys').default;
const cloudinary = require('cloudinary').v2;
const qrcode = require('qrcode');
const fs = require('fs').promises; // Usamos fs.promises para manejo asíncrono de archivos

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

    if (estado && estado.timeoutId) {
        clearTimeout(estado.timeoutId);
    }

    if (estado && estado.nivel !== "con_asesor") {
        estado.timeoutId = setTimeout(async () => {
            await sock.sendMessage(remitente, { text: "Han pasado 5 minutos sin respuesta. La conversación ha expirado. Escribe 'hola' para empezar de nuevo." });
            delete estadosConversacion[remitente];
        }, TIMEOUT_MS);
    }
}

// Funciones de texto para menús (igual que el original)
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
    \n4. ¡Quiero trabajar en Pamii!
    \n5. ¡Chao!
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

// Definición de los handlers para cada etapa (adaptado para Baileys)
const stageHandlers = {
    inicio: async (message, estado) => {
        await sock.sendMessage(message.key.remoteJid, { text: menus.terminos });
        estadosConversacion[message.key.remoteJid] = { nivel: "terminos", timeoutId: null };
    },
    terminos: async (message, estado) => {
        const opcion = message.message.conversation.trim();
        const opciones = {
            "1": { nivel: "principal", respuesta: menus.principal },
            "2": { nivel: null, respuesta: "Acepta los términos y condiciones para continuar" },
        };
        const seleccion = opciones[opcion] || { respuesta: "Opción no válida. Selecciona 1 para aceptar o 2 para rechazar." };
        await sock.sendMessage(message.key.remoteJid, { text: seleccion.respuesta });
        if (seleccion.nivel === null) {
            delete estadosConversacion[message.key.remoteJid];
        } else if (seleccion.nivel) {
            estadosConversacion[message.key.remoteJid] = { nivel: seleccion.nivel, timeoutId: null };
        }
    },
    principal: async (message, estado) => {
        const opcion = message.message.conversation.trim();
        const opciones = {
            "1": { nivel: "asesor", respuesta: menus.asesor },
            "2": { nivel: "pedido", respuesta: menus.pedido },
            "3": { nivel: "reclamos", respuesta: menus.reclamos },
            "4": { nivel: "esperando_cv", respuesta: "Por favor, adjunta o carga tu hoja de vida." },
            "5": { nivel: null, respuesta: "Conversación finalizada. Escribe 'hola' para iniciar de nuevo." },
        };
        const seleccion = opciones[opcion] || { respuesta: "Opción no válida. Seleccione un número del 1 al 5." };
        await sock.sendMessage(message.key.remoteJid, { text: seleccion.respuesta });
        if (seleccion.nivel === null) {
            delete estadosConversacion[message.key.remoteJid];
        } else if (seleccion.nivel) {
            estado.nivel = seleccion.nivel;
        }
    },
    asesor: async (message, estado) => {
        const opcion = message.message.conversation.trim();
        const opciones = {
            "1": { nivel: "con_asesor", tipo: "ventas", respuesta: "¡Ok! 😉 Un asesor de Ventas y Productos te contactará en breve." },
            "2": { nivel: "con_asesor", tipo: "soporte", respuesta: "¡Ok! 😉 Un asesor de Soporte Técnico te contactará en breve." },
            "3": { nivel: "principal", respuesta: menus.principal },
        };
        const seleccion = opciones[opcion] || { respuesta: "Opción no válida. Seleccione un número del 1 al 3." };
        await sock.sendMessage(message.key.remoteJid, { text: seleccion.respuesta });
        if (seleccion.nivel) {
            estado.nivel = seleccion.nivel;
            if (seleccion.tipo) estado.tipo = seleccion.tipo;
        }
    },
    pedido: async (message, estado) => {
        const opcion = message.message.conversation.trim();
        const opciones = {
            "1": { nivel: "esperando_numero_pedido", respuesta: "Por favor, indique el número de su pedido." },
            "2": { nivel: "pedido", respuesta: ["Consultando sus pedidos recientes... Un momento, por favor.", "No hay pedidos recientes registrados. Si desea, indique un número de pedido específico."] },
            "3": { nivel: "principal", respuesta: menus.principal },
        };
        const seleccion = opciones[opcion] || { respuesta: "Opción no válida. Seleccione un número del 1 al 3." };
        if (Array.isArray(seleccion.respuesta)) {
            for (const msg of seleccion.respuesta) await sock.sendMessage(message.key.remoteJid, { text: msg });
        } else {
            await sock.sendMessage(message.key.remoteJid, { text: seleccion.respuesta });
        }
        if (seleccion.nivel) estado.nivel = seleccion.nivel;
    },
    esperando_numero_pedido: async (message, estado) => {
        const numeroPedido = message.message.conversation.trim();
        await sock.sendMessage(message.key.remoteJid, { text: `Gracias. Su pedido es el #${numeroPedido}.` });
        await sock.sendMessage(message.key.remoteJid, { text: "Un asesor está revisando el estado de su pedido. Por favor, espere un momento." });
        estado.nivel = "con_asesor";
        estado.tipo = "pedido";
    },
    reclamos: async (message, estado) => {
        const opcion = message.message.conversation.trim();
        const opciones = {
            "1": { nivel: "esperando_descripcion_reclamo", respuesta: "Por favor, describa brevemente su reclamo." },
            "2": { nivel: "esperando_numero_reclamo", respuesta: "Por favor, indique el número de su reclamo." },
            "3": { nivel: "esperando_numero_devolucion", respuesta: "Por favor, indique el número de pedido para la devolución." },
            "4": { nivel: "principal", respuesta: menus.principal },
        };
        const seleccion = opciones[opcion] || { respuesta: "Opción no válida. Seleccione un número del 1 al 4." };
        await sock.sendMessage(message.key.remoteJid, { text: seleccion.respuesta });
        if (seleccion.nivel) estado.nivel = seleccion.nivel;
    },
    esperando_descripcion_reclamo: async (message, estado) => {
        await sock.sendMessage(message.key.remoteJid, { text: `Reclamo registrado: "${message.message.conversation.trim()}". Un asesor lo revisará pronto.` });
        estado.nivel = "con_asesor";
        estado.tipo = "reclamo";
    },
    esperando_numero_reclamo: async (message, estado) => {
        const numeroReclamo = message.message.conversation.trim();
        await sock.sendMessage(message.key.remoteJid, { text: `Gracias. Su reclamo es el #${numeroReclamo}.` });
        await sock.sendMessage(message.key.remoteJid, { text: "Un asesor está revisando el estado de su reclamo. Por favor, espere un momento." });
        estado.nivel = "con_asesor";
        estado.tipo = "reclamo";
    },
    esperando_numero_devolucion: async (message, estado) => {
        const numeroDevolucion = message.message.conversation.trim();
        await sock.sendMessage(message.key.remoteJid, { text: `Solicitud de devolución para el pedido #${numeroDevolucion} registrada. Un asesor lo contactará pronto.` });
        estado.nivel = "con_asesor";
        estado.tipo = "devolucion";
    },
    esperando_cv: async (message, estado) => {
        if (message.message.documentMessage) {
            await sock.sendMessage(message.key.remoteJid, { text: "Cargue de CV exitoso. Un asesor lo contactará pronto." });
            estado.nivel = "con_asesor";
            estado.tipo = "cv";
        } else {
            await sock.sendMessage(message.key.remoteJid, { text: "Por favor, envíe un documento con su CV." });
        }
    },
    con_asesor: async (message, estado) => {
        // No responde nada, está con un asesor
    },
};

// Conexión con Baileys
let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_state');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Desactivamos el QR en terminal porque usaremos Cloudinary
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                // Generar el QR como imagen y guardarlo temporalmente
                const qrImagePath = './qr-code.png';
                await qrcode.toFile(qrImagePath, qr, {
                    color: {
                        dark: '#000000', // Color del QR
                        light: '#FFFFFF', // Fondo
                    },
                });
                console.log('QR generado como imagen en:', qrImagePath);

                // Subir la imagen a Cloudinary
                const result = await cloudinary.uploader.upload(qrImagePath, {
                    folder: 'whatsapp-qr', // Carpeta en Cloudinary
                    overwrite: true, // Sobrescribir si ya existe
                });
                console.log('Escanea el QR desde este enlace:', result.secure_url);

                // Eliminar el archivo local después de subirlo
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
        if (!message.message || message.key.fromMe) return; // Ignorar mensajes enviados por el bot

        const remitente = message.key.remoteJid;
        const texto = message.message.conversation?.toLowerCase() || '';

        if (texto === "hola") {
            await sock.sendMessage(remitente, { text: menus.terminos });
            estadosConversacion[remitente] = { nivel: "terminos", timeoutId: null };
            setTimeoutForUser(remitente);
            return;
        }

        if (texto === "salir" && estadosConversacion[remitente]) {
            await sock.sendMessage(remitente, { text: "Has salido del modo actual. Escribe 'hola' para ver el menú." });
            if (estadosConversacion[remitente].timeoutId) {
                clearTimeout(estadosConversacion[remitente].timeoutId);
            }
            delete estadosConversacion[remitente];
            return;
        }

        if (!estadosConversacion[remitente]) {
            await stageHandlers.inicio(message, {});
            return;
        }

        const estado = estadosConversacion[remitente];
        const handler = stageHandlers[estado.nivel] || stageHandlers.inicio;
        await handler(message, estado);

        setTimeoutForUser(remitente);
    });
}

// Iniciar la conexión
connectToWhatsApp().catch(err => console.error('Error en la conexión:', err));