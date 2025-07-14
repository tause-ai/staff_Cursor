// main.js - Proceso principal de Electron
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const fetch = require('node-fetch');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const pdf = require('pdf-parse');
const InspectModule = require('docxtemplater/js/inspect-module.js');
const { NumerosALetras } = require('numero-a-letras');
const mammoth = require('mammoth');
const { getDatabase } = require(path.join(__dirname, 'database.cjs'));


const iModule = InspectModule();
let mainWindow;
let isFetchingProcesses = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'src/preload.js') // Corregimos la ruta al preload
    },
    // icon: path.join(__dirname, 'assets/icon.png'), // Opcional
    titleBarStyle: 'default',
    show: false
  });

  // Cargar la app React
  const isDev = !app.isPackaged; // Una forma más fiable de detectar el modo desarrollo
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173'); // Puerto correcto de Vite
    mainWindow.webContents.openDevTools();
  } else {
    // En producción, servimos los archivos desde el build de Vite
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // --- Manejo de Recarga ---
  // Cuando el usuario recarga la ventana (Cmd+R o F5), le decimos a React
  // que vuelva a pedir los procesos.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('reload-processes');
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// --- LÓGICA DE NEGOCIO STAFF 2 ---

const numerosALetras = new NumerosALetras();

// Función auxiliar para obtener la base de datos SQLite (sin migración automática)
async function getDBInstance() {
  try {
    const db = getDatabase();
    const stats = db.getStats();
    
    console.log(`[Electron Backend] Base de datos SQLite - Procesos: ${stats.procesos}, Datos editados: ${stats.mapped_data}`);
    
    return db;
  } catch (error) {
    console.error('[Electron Backend] Error al obtener instancia de BD:', error);
    return getDatabase(); // Devolver la base de datos aunque falle
  }
}

// Obtener y cachear los procesos de la API (ahora usando SQLite)
ipcMain.handle('app:getProcesses', async () => {
  if (isFetchingProcesses) {
    console.log('[Electron Backend] La obtención de procesos ya está en curso.');
    // Si ya hay una petición en curso, devolver datos desde la base de datos
    try {
      const db = await getDBInstance();
      const processes = db.getAllProcesses();
      return { source: 'database-while-fetching', data: processes };
    } catch (error) {
      console.error('[Electron Backend] Error al obtener procesos desde BD:', error);
      return { source: 'database-while-fetching', data: [] };
    }
  }

  isFetchingProcesses = true;

  try {
    // --- INTENTAR OBTENER DATOS DE LA API ---
    console.log('[Electron Backend] Intentando obtener procesos desde la API...');
    const controller = new AbortController();
    // Timeout aumentado a 15 segundos para la conexión inicial
    const timeout = setTimeout(() => {
      console.log('[Electron Backend] Timeout de API alcanzado.');
      controller.abort();
    }, 15000);

    const processIdsResponse = await fetch('http://192.168.145.6/api/v1/bots/bot_proceso_ids', {
      signal: controller.signal
    });
    clearTimeout(timeout); // Cancelamos el timeout si la respuesta llega a tiempo

    if (!processIdsResponse.ok) {
      throw new Error(`Respuesta no exitosa de la API: ${processIdsResponse.statusText}`);
    }
    
    const processIds = await processIdsResponse.json();
    console.log(`[Electron Backend] Obtenidos ${processIds.length} IDs de procesos.`);

    const processDetailsPromises = processIds.map(id => {
      const detailController = new AbortController();
      const detailTimeout = setTimeout(() => detailController.abort(), 10000); // Timeout aumentado a 10 segundos por detalle
      
      return fetch(`http://192.168.145.6/api/v1/bots/bot_documentos/${id}`, { signal: detailController.signal })
        .then(res => {
          clearTimeout(detailTimeout);
          if (res.ok) return res.json();
          console.warn(`[Electron Backend] No se pudo obtener detalle para el proceso ID ${id}. Estado: ${res.status}`);
          return null; // Devolver null si la petición individual falla
        })
        .catch(err => {
            clearTimeout(detailTimeout);
            console.warn(`[Electron Backend] Error de red obteniendo detalle para el proceso ID ${id}: ${err.message}`);
            return null;
        });
    });

    const allDetailsResults = await Promise.all(processDetailsPromises);
    
    // Filtramos los resultados nulos y enriquecemos los datos
    const enrichedProcesses = allDetailsResults
        .filter(detail => detail && detail.proceso_id) // Nos aseguramos que el detalle no sea nulo y tenga un ID
        .map(detail => ({
            ...detail,
            id: detail.proceso_id, // Aseguramos que 'id' exista en el nivel superior
            entidad: detail.cliente?.razon,
        }));

    console.log(`[Electron Backend] Obtenidos ${enrichedProcesses.length} detalles completos de procesos.`);

    // Guardar los datos frescos en la base de datos
    try {
        const db = await getDBInstance();
        const result = db.upsertProcesses(enrichedProcesses);
        
        if (result.success) {
          console.log(`[Electron Backend] ${result.count} procesos guardados en base de datos`);
        } else {
          console.error(`[Electron Backend] Error al guardar en base de datos: ${result.error}`);
        }
    } catch (writeError) {
        console.error(`[Electron Backend] Error al escribir en base de datos: ${writeError.message}`);
    }
    
    isFetchingProcesses = false;
    return { source: 'api', data: enrichedProcesses };

  } catch (error) {
    // --- FALLBACK A DATOS LOCALES DESDE LA BASE DE DATOS ---
    isFetchingProcesses = false;
    console.warn(`[Electron Backend] Fallo al conectar con la API: ${error.message}. Intentando cargar desde base de datos.`);
    
    try {
      const db = await getDBInstance();
      const processes = db.getAllProcesses();
      console.log(`[Electron Backend] Éxito al cargar ${processes.length} procesos desde la base de datos.`);
      return { source: 'database', data: processes };
    } catch (dbError) {
      console.error(`[Electron Backend] Error al leer la base de datos: ${dbError.message}`);
      
      // Si todo lo demás falla, devolvemos un error.
      return { source: 'error', data: [], error: 'No se pudo conectar a la API ni cargar datos desde la base de datos.' };
    }
  }
});

// Obtener solo los IDs de procesos directamente de la API (para configuración)
ipcMain.handle('app:getApiProcessIds', async () => {
  console.log('[Electron Backend] Obteniendo IDs de procesos directamente de la API...');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      console.log('[Electron Backend] Timeout alcanzado para obtener IDs de API.');
      controller.abort();
    }, 15000);

    const response = await fetch('http://192.168.145.6/api/v1/bots/bot_proceso_ids', {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Error de API: ${response.statusText}`);
    }
    
    const processIds = await response.json();
    console.log(`[Electron Backend] Obtenidos ${processIds.length} IDs de la API:`, processIds);
    
    return { 
      success: true, 
      data: processIds,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error(`[Electron Backend] Error al obtener IDs de la API: ${error.message}`);
    return { 
      success: false, 
      error: error.message,
      data: [],
      timestamp: new Date().toISOString()
    };
  }
});

// Obtener IDs de procesos del caché local (ahora usando SQLite)
ipcMain.handle('app:getLocalProcessIds', async () => {
  console.log('[Electron Backend] Obteniendo IDs de procesos desde la base de datos...');
  try {
    const db = await getDBInstance();
    const processes = db.getAllProcesses();
    
    const localIds = processes.map(process => process.proceso_id).filter(id => id);
    console.log(`[Electron Backend] Obtenidos ${localIds.length} IDs desde la base de datos:`, localIds);
    
    return { 
      success: true, 
      data: localIds,
      totalProcesses: processes.length,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error(`[Electron Backend] Error al leer desde la base de datos: ${error.message}`);
    return { 
      success: false, 
      error: error.message,
      data: [],
      totalProcesses: 0,
      timestamp: new Date().toISOString()
    };
  }
});

// Sincronizar procesos: eliminar de la base de datos los que no están en la API
ipcMain.handle('app:syncProcesses', async () => {
  console.log('[Electron Backend] Iniciando sincronización de procesos...');
  try {
    const db = await getDBInstance();
    
    // Obtener procesos locales desde la base de datos
    const localProcesses = db.getAllProcesses();
    
    // Obtener IDs directamente de la API usando fetch
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch('http://192.168.145.6/api/v1/bots/bot_proceso_ids', {
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Error de API: ${response.statusText}`);
    }
    
    const apiIds = await response.json();
    const localIds = localProcesses.map(p => p.proceso_id);
    
    console.log(`[Sincronización] API tiene ${apiIds.length} procesos`);
    console.log(`[Sincronización] Base de datos tiene ${localIds.length} procesos`);
    
    // Encontrar procesos que están en local pero no en API (obsoletos)
    const obsoleteIds = localIds.filter(localId => !apiIds.includes(localId));
    
    console.log(`[Sincronización] Procesos obsoletos encontrados: ${obsoleteIds.length}`, obsoleteIds);
    
    // Eliminar procesos obsoletos de la base de datos
    let removedCount = 0;
    if (obsoleteIds.length > 0) {
      const result = db.deleteProcesses(obsoleteIds);
      removedCount = result.deletedCount;
      console.log(`[Sincronización] Eliminados ${removedCount} procesos obsoletos de la base de datos.`);
    }
    
    // Obtener procesos válidos después de la limpieza
    const validProcesses = db.getAllProcesses();
    
    return {
      success: true,
      apiIds: apiIds,
      localIds: localIds,
      obsoleteIds: obsoleteIds,
      validProcesses: validProcesses.length,
      removedCount: removedCount,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error(`[Electron Backend] Error en sincronización: ${error.message}`);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
});

// Obtener los campos de una plantilla Word
ipcMain.handle('app:getTemplateFields', async (event, clientName, process = null) => {
  console.log(`[getTemplateFields] Buscando plantilla para cliente: "${clientName}"`);
  try {
    if (!clientName) {
      console.warn('[getTemplateFields] Se recibió un nombre de cliente vacío.');
      return [];
    }
    
    const templatesDir = path.join(__dirname, 'formatos', 'demandas');
    const files = await fs.readdir(templatesDir);
    console.log(`[getTemplateFields] Archivos disponibles en demandas:`, files);

    let templateFile = null;
    
    // Si tenemos información del proceso, usar la nueva lógica que considera pagarés
    if (process) {
      console.log(`[getTemplateFields] Usando lógica inteligente de selección con proceso:`, process.proceso_id);
      const cantidadPagares = detectarCantidadPagares(process);
      templateFile = buscarPlantillaConPagares(files, clientName, cantidadPagares);
    }
    
    // Fallback a la lógica original si no se encontró con la nueva lógica
    if (!templateFile) {
      console.log(`[getTemplateFields] Usando lógica original de selección`);
    
    // Normalizar el nombre del cliente para la búsqueda
    const normalizedClientName = clientName.toLowerCase()
      .replace(/\./g, '')
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
    
    console.log(`[getTemplateFields] Nombre normalizado para búsqueda: "${normalizedClientName}"`);
    
    // Estrategia 1: Buscar archivo que empiece con el nombre normalizado
    templateFile = files.find(file => {
      const normalizedFileName = file.toLowerCase()
        .replace(/\./g, '')
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/g, '');
      return normalizedFileName.startsWith(normalizedClientName) && file.endsWith('.docx');
    });
    
    // Estrategia 2: Buscar por palabras clave del nombre
    if (!templateFile && clientName) {
      const keywords = clientName.toLowerCase().split(/\s+/);
      templateFile = files.find(file => {
        const lowerFile = file.toLowerCase();
        return keywords.some(keyword => 
          keyword.length > 2 && 
          lowerFile.startsWith(keyword.toLowerCase()) && 
          file.endsWith('.docx')
        );
      });
      }
    }

    if (!templateFile) {
      console.warn(`[getTemplateFields] No se encontró plantilla para "${clientName}" en ${templatesDir}`);
      return []; // Devolvemos un array vacío si no hay plantilla
    }
    
    console.log(`[getTemplateFields] Plantilla encontrada: "${templateFile}"`);

    const templatePath = path.join(templatesDir, templateFile);
    const content = await fs.readFile(templatePath);
    
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      delimiters: {
            start: '«',
            end: '»'
      },
      paragraphsLoop: true,
      linebreaks: true,
      modules: [iModule]
    });

    doc.render(); // La inspección se ejecuta durante el render
    const tags = iModule.getAllTags();
    const tagNames = Object.keys(tags);
    console.log(`[getTemplateFields] Se encontraron ${tagNames.length} campos:`, tagNames);
    
    // Devolvemos solo los nombres de las etiquetas (las llaves del objeto)
    return tagNames;

  } catch (error) {
    console.error(`Error al obtener los campos de la plantilla para "${clientName}":`, error);
    dialog.showErrorBox('Error de Plantilla', `No se pudieron leer los campos de la plantilla para ${clientName}. Verifique que el archivo no esté corrupto.`);
    return []; // Devolver vacío en caso de error
  }
});

// Obtener los campos de una plantilla de portada
ipcMain.handle('app:getCoverTemplateFields', async (event, clientName) => {
  console.log(`[getCoverTemplateFields] Buscando plantilla de portada para cliente: "${clientName}"`);
  try {
    if (!clientName) {
      console.warn('[getCoverTemplateFields] Se recibió un nombre de cliente vacío.');
      return [];
    }
    
    // Normalizar el nombre del cliente para la búsqueda
    const normalizedClientName = clientName.toLowerCase()
      .replace(/\./g, '')
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
    
    console.log(`[getCoverTemplateFields] Nombre normalizado para búsqueda: "${normalizedClientName}"`);
    
    const coversDir = path.join(__dirname, 'formatos', 'Portadas');
    const files = await fs.readdir(coversDir);
    console.log(`[getCoverTemplateFields] Archivos disponibles en Portadas:`, files);

    // Buscar archivo de portada - Búsqueda más flexible
    let coverFile = null;
    
    // Estrategia 1: Buscar por nombre exacto normalizado
    coverFile = files.find(file => {
      const normalizedFileName = file.toLowerCase()
        .replace(/\./g, '')
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/g, '');
      const normalizedSearch = normalizedClientName;
      console.log(`[getCoverTemplateFields] Comparando: "${normalizedFileName}" contiene "portada"? ${normalizedFileName.includes('portada')} y "${normalizedSearch}"? ${normalizedFileName.includes(normalizedSearch)}`);
      return normalizedFileName.includes('portada') && 
             normalizedFileName.includes(normalizedSearch) && 
             file.endsWith('.docx');
    });
    
    console.log(`[getCoverTemplateFields] Búsqueda inicial resultado: ${coverFile || 'NO ENCONTRADO'}`);
    
    // Estrategia 2: Buscar por palabras clave más flexibles
    if (!coverFile && clientName) {
      console.log(`[getCoverTemplateFields] Intentando fallback con palabras clave...`);
      const keywords = clientName.toLowerCase().split(/\s+/);
      console.log(`[getCoverTemplateFields] Palabras clave: ${keywords.join(', ')}`);
      
      coverFile = files.find(file => {
        const lowerFile = file.toLowerCase();
        const hasPortada = lowerFile.includes('portada');
        const hasKeyword = keywords.some(keyword => {
          const match = keyword.length > 2 && lowerFile.includes(keyword.toLowerCase());
          console.log(`[getCoverTemplateFields] Archivo "${file}" - palabra "${keyword}": ${match}`);
          return match;
        });
        console.log(`[getCoverTemplateFields] Archivo "${file}" - tiene portada: ${hasPortada}, tiene keyword: ${hasKeyword}`);
        return hasPortada && hasKeyword && file.endsWith('.docx');
      });
    }
    
    // Estrategia 3: Buscar por coincidencia parcial más amplia
    if (!coverFile && clientName) {
      console.log(`[getCoverTemplateFields] Intentando búsqueda parcial amplia...`);
      coverFile = files.find(file => {
        const lowerFile = file.toLowerCase();
        const lowerClient = clientName.toLowerCase();
        
        // Buscar si cualquier parte del nombre del cliente aparece en el archivo
        const hasPortada = lowerFile.includes('portada');
        const hasPartialMatch = lowerClient.length >= 4 && lowerFile.includes(lowerClient.substring(0, 4));
        
        console.log(`[getCoverTemplateFields] Archivo "${file}" - búsqueda amplia - portada: ${hasPortada}, coincidencia parcial: ${hasPartialMatch}`);
        return hasPortada && hasPartialMatch && file.endsWith('.docx');
      });
    }
    
    console.log(`[getCoverTemplateFields] Resultado final: ${coverFile || 'NO ENCONTRADO'}`);
    
    // Fallback final: usar cualquier portada disponible para debugging
    if (!coverFile) {
      console.warn(`[getCoverTemplateFields] No se encontró portada específica, usando primera disponible para debugging`);
      coverFile = files.find(file => file.toLowerCase().includes('portada') && file.endsWith('.docx'));
      console.log(`[getCoverTemplateFields] Fallback final: ${coverFile || 'NINGUNA PORTADA ENCONTRADA'}`);
    }

    if (!coverFile) {
      console.warn(`[getCoverTemplateFields] No se encontró plantilla de portada para "${clientName}" en ${coversDir}`);
      return []; // Devolvemos un array vacío si no hay plantilla
    }
    
    console.log(`[getCoverTemplateFields] Plantilla de portada encontrada: "${coverFile}"`);

    const coverPath = path.join(coversDir, coverFile);
    const content = await fs.readFile(coverPath);
    
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      delimiters: {
            start: '«',
            end: '»'
      },
      paragraphsLoop: true,
      linebreaks: true,
      modules: [iModule]
    });

    doc.render(); // La inspección se ejecuta durante el render
    const tags = iModule.getAllTags();
    const tagNames = Object.keys(tags);
    console.log(`[getCoverTemplateFields] Se encontraron ${tagNames.length} campos en portada:`, tagNames);
    
    // Devolvemos solo los nombres de las etiquetas (las llaves del objeto)
    return tagNames;

  } catch (error) {
    console.error(`Error al obtener los campos de la plantilla de portada para "${clientName}":`, error);
    dialog.showErrorBox('Error de Plantilla de Portada', `No se pudieron leer los campos de la plantilla de portada para ${clientName}. Verifique que el archivo no esté corrupto.`);
    return []; // Devolver vacío en caso de error
  }
});

// Función auxiliar para mapear los datos de un proceso a los campos de la plantilla
async function getProcessMappedData(process) {
  console.log('[getProcessMappedData] Iniciando mapeo dinámico para el proceso:', process.proceso_id);
  console.log('[getProcessMappedData] Cliente:', process.cliente?.razon);
  
  try {
    // Verificar si existe datos modificados en la base de datos
    const db = await getDBInstance();
    const cachedData = db.getMappedData(process.proceso_id);
    
    if (Object.keys(cachedData).length > 0) {
      console.log('[getProcessMappedData] Datos encontrados en base de datos, usando versión modificada');
      return cachedData;
    } else {
      console.log('[getProcessMappedData] No se encontraron datos modificados, procesando datos originales');
    }
    // 1. Obtener los campos requeridos por la plantilla de esta entidad
    const clientName = process.cliente?.razon || '';
    let templateFields = [];
    
    // Obtener campos de la plantilla usando la nueva lógica inteligente
    try {
      if (clientName) {
        const templatesDir = path.join(__dirname, 'formatos', 'demandas');
        const files = await fs.readdir(templatesDir);
        
        // NUEVA LÓGICA: Detectar cantidad de pagarés y buscar plantilla apropiada
        const cantidadPagares = detectarCantidadPagares(process);
        console.log('[getProcessMappedData] Cantidad de pagarés detectada para mapeo:', cantidadPagares);
        
        let templateFile = buscarPlantillaConPagares(files, clientName, cantidadPagares);
        
        // Fallback a lógica original si no encontró con la nueva lógica
        if (!templateFile) {
          console.log('[getProcessMappedData] Usando lógica original para buscar plantilla');
          
        const normalizedClientName = clientName.toLowerCase()
          .replace(/\./g, '')
          .replace(/\s+/g, '')
          .replace(/[^a-z0-9]/g, '');
        
        // Buscar archivo que empiece con el nombre del cliente
          templateFile = files.find(file => {
          const normalizedFileName = file.toLowerCase()
            .replace(/\./g, '')
            .replace(/\s+/g, '')
            .replace(/[^a-z0-9]/g, '');
          return normalizedFileName.startsWith(normalizedClientName) && file.endsWith('.docx');
        });
        
        // Fallback: buscar por palabras clave
        if (!templateFile && clientName) {
          const keywords = clientName.toLowerCase().split(/\s+/);
          templateFile = files.find(file => {
            const lowerFile = file.toLowerCase();
            return keywords.some(keyword => 
              keyword.length > 2 && 
              lowerFile.startsWith(keyword.toLowerCase()) && 
              file.endsWith('.docx')
            );
          });
          }
        }
        
        if (templateFile) {
          const templatePath = path.join(templatesDir, templateFile);
          const content = await fs.readFile(templatePath);
          const zip = new PizZip(content);
          const doc = new Docxtemplater(zip, {
            delimiters: { start: '«', end: '»' },
            paragraphsLoop: true,
            linebreaks: true,
            modules: [iModule]
          });
          doc.render();
          const tags = iModule.getAllTags();
          templateFields = Object.keys(tags);
          console.log('[getProcessMappedData] Campos encontrados en plantilla:', templateFields);
        }
      }
    } catch (templateError) {
      console.warn('[getProcessMappedData] Error al leer plantilla:', templateError.message);
    }
    
    if (templateFields.length === 0) {
      console.warn('[getProcessMappedData] No se encontraron campos de plantilla para:', clientName);
      // En lugar de retornar vacío, usamos un conjunto básico de campos comunes
      templateFields = ['JUZGADO', 'DEMANDADO_1', 'CUANTIA', 'DIRECCION_NOTIFICACION', 'CORREO'];
      console.log('[getProcessMappedData] Usando campos básicos:', templateFields);
    }
    
    // 2. Preparar datos del proceso - Mejorado para manejar múltiples deudores
    let deudores = [];
    
    // Estrategia 1: Si hay array de deudores en la API
    if (process.deudores && Array.isArray(process.deudores)) {
        deudores = process.deudores;
        console.log('[getProcessMappedData] Encontrados deudores en array:', deudores.length);
    } 
    // Estrategia 2: Si hay deudor y codeudor por separado
    else if (process.deudor && process.codeudor) {
        deudores = [process.deudor, process.codeudor];
        console.log('[getProcessMappedData] Encontrados deudor y codeudor por separado');
    }
    // Estrategia 3: Solo deudor principal
    else if (process.deudor) {
        deudores = [process.deudor];
        console.log('[getProcessMappedData] Solo deudor principal encontrado');
    }

    const cliente = process.cliente || {};
    const deudorPrincipal = deudores.length > 0 ? deudores[0] : {};
    const deudorSecundario = deudores.length > 1 ? deudores[1] : {};
    
    // Log para debugging
    console.log('[getProcessMappedData] Deudor principal:', {
      nombre: deudorPrincipal.nombre,
      cedula: deudorPrincipal.cedula || deudorPrincipal.documento,
      direccion: deudorPrincipal.direccion
    });
    
    if (deudorSecundario.nombre) {
      console.log('[getProcessMappedData] Deudor secundario (codeudor):', {
        nombre: deudorSecundario.nombre,
        cedula: deudorSecundario.cedula || deudorSecundario.documento,
        direccion: deudorSecundario.direccion
      });
    }
    
    // 3. Extraer datos del PDF pagaré si está disponible
    let datosPagare = {};
    try {
      console.log('[getProcessMappedData] Verificando estructura de documentos...');
      console.log('[getProcessMappedData] process.documentos existe:', !!process.documentos);
      
      if (process.documentos) {
        console.log('[getProcessMappedData] Documentos disponibles:', Object.keys(process.documentos));
        console.log('[getProcessMappedData] process.documentos.pagare existe:', !!process.documentos.pagare);
        
        if (process.documentos.pagare) {
          console.log('[getProcessMappedData] Estructura del pagaré:', {
            filename: process.documentos.pagare.filename,
            content_type: process.documentos.pagare.content_type,
            hasBase64: !!process.documentos.pagare.base64,
            hasData: !!process.documentos.pagare.data,
            base64Length: process.documentos.pagare.base64?.length || 0,
            dataLength: process.documentos.pagare.data?.length || 0
          });
          
          // Verificar si es base64 o data
          const pdfData = process.documentos.pagare.base64 || process.documentos.pagare.data;
          
          if (pdfData) {
            console.log('[getProcessMappedData] Extrayendo datos del PDF pagaré...');
            datosPagare = await extraerDatosPagare(pdfData);
            console.log('[getProcessMappedData] Datos extraídos del pagaré:', datosPagare);
          } else {
            console.warn('[getProcessMappedData] No se encontró contenido base64 ni data en el pagaré');
          }
        } else {
          console.warn('[getProcessMappedData] No se encontró documento pagaré');
        }
      } else {
        console.warn('[getProcessMappedData] No se encontraron documentos en el proceso');
      }
    } catch (error) {
      console.warn('[getProcessMappedData] Error al extraer datos del pagaré:', error.message);
    }

    // 4. Mapeo dinámico completo - todos los posibles campos
    const allPossibleMappings = {
      // Información del juzgado
      'JUZGADO': process.juzgado_origen || process.juzgado || 'Juzgado Civil Municipal',
      'CIUDAD': process.ciudad || deudorPrincipal.ciudad || cliente.ciudad || 'Bogotá D.C.',
      'DOMICILIO': deudorPrincipal.ciudad || process.ciudad || 'Bogotá D.C.',
      
      // Información de cuantía (calcular automáticamente basado en el valor) - Múltiples variaciones
      'CUANTIA': calcularCuantia(datosPagare.valor || process.valor) || process.cuantia || 'MÍNIMA',
      'VALOR': datosPagare.valorFormateado || formatearValorCompleto(process.valor || process.cuantia) || process.valor || process.cuantia || '',
      'MONTO': datosPagare.valorFormateado || formatearValorCompleto(process.monto || process.valor || process.cuantia) || process.monto || process.valor || process.cuantia || '',
      'VALOR_CAPITAL': datosPagare.valorFormateado || formatearValorCompleto(process.valor_capital || process.valor) || process.valor_capital || process.valor || '',
      'VALOR_INTERESES': process.valor_intereses || '',
      'VALOR_TOTAL': datosPagare.valorFormateado || formatearValorCompleto(process.valor_total || process.valor) || process.valor_total || process.valor || '',
      'VALOR_ADEUDADO': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '', // Variación adicional
      'SUMA_ADEUDADA': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '', // Variación adicional
      'IMPORTE': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '', // Variación adicional
      
      // Información del demandante (cliente)
      'DEMANDANTE': cliente.razon || cliente.nombre || '',
      'CLIENTE': cliente.razon || cliente.nombre || '',
      'ENTIDAD': cliente.razon || cliente.nombre || '',
      'RAZON_SOCIAL': cliente.razon || cliente.nombre || '',
      'NIT_DEMANDANTE': cliente.nit || '',
      'DIRECCION_DEMANDANTE': cliente.direccion || '',
      
      // Información del demandado principal (priorizar datos del PDF, luego API)
      'DEMANDADO': datosPagare.deudorCompleto || formatearNombreConCC(deudorPrincipal.nombre, deudorPrincipal.cedula || deudorPrincipal.documento),
      'DEMANDADO_1': datosPagare.deudorCompleto || formatearNombreConCC(deudorPrincipal.nombre, deudorPrincipal.cedula || deudorPrincipal.documento),
      'DEUDOR': datosPagare.deudorCompleto || formatearNombreConCC(deudorPrincipal.nombre, deudorPrincipal.cedula || deudorPrincipal.documento),
      'NOMBRE_DEUDOR': datosPagare.deudorCompleto || formatearNombreConCC(deudorPrincipal.nombre, deudorPrincipal.cedula || deudorPrincipal.documento),
      'NOMBRES_DEUDOR': datosPagare.deudorCompleto || formatearNombreConCC(deudorPrincipal.nombre, deudorPrincipal.cedula || deudorPrincipal.documento),
      'CEDULA_DEUDOR': datosPagare.cedulaDeudor || deudorPrincipal.cedula || deudorPrincipal.documento || '',
      'DOCUMENTO_DEUDOR': datosPagare.cedulaDeudor || deudorPrincipal.cedula || deudorPrincipal.documento || '',
      'CC_DEUDOR': datosPagare.cedulaDeudor || deudorPrincipal.cedula || deudorPrincipal.documento || '',
      'DIRECCION_DEUDOR': deudorPrincipal.direccion || '',
      'TELEFONO_DEUDOR': deudorPrincipal.telefono || '',
      'EMAIL_DEUDOR': deudorPrincipal.email || '',
      'CIUDAD_DEUDOR': deudorPrincipal.ciudad || '',
      
      // Información del demandado secundario/codeudor (priorizar datos del PDF, luego API)
      'DEMANDADO_2': datosPagare.codeudorCompleto || formatearNombreConCC(deudorSecundario.nombre, deudorSecundario.cedula || deudorSecundario.documento),
      'DEUDOR_2': datosPagare.codeudorCompleto || formatearNombreConCC(deudorSecundario.nombre, deudorSecundario.cedula || deudorSecundario.documento),
      'CODEUDOR': datosPagare.codeudorCompleto || formatearNombreConCC(deudorSecundario.nombre, deudorSecundario.cedula || deudorSecundario.documento),
      'NOMBRE_DEUDOR_2': datosPagare.codeudorCompleto || formatearNombreConCC(deudorSecundario.nombre, deudorSecundario.cedula || deudorSecundario.documento),
      'NOMBRE_CODEUDOR': datosPagare.codeudorCompleto || formatearNombreConCC(deudorSecundario.nombre, deudorSecundario.cedula || deudorSecundario.documento),
      'NOMBRES_CODEUDOR': datosPagare.codeudorCompleto || formatearNombreConCC(deudorSecundario.nombre, deudorSecundario.cedula || deudorSecundario.documento),
      'CEDULA_DEUDOR_2': datosPagare.cedulaCodeudor || deudorSecundario.cedula || deudorSecundario.documento || '',
      'CEDULA_CODEUDOR': datosPagare.cedulaCodeudor || deudorSecundario.cedula || deudorSecundario.documento || '',
      'DOCUMENTO_DEUDOR_2': datosPagare.cedulaCodeudor || deudorSecundario.cedula || deudorSecundario.documento || '',
      'DOCUMENTO_CODEUDOR': datosPagare.cedulaCodeudor || deudorSecundario.cedula || deudorSecundario.documento || '',
      'CC_CODEUDOR': datosPagare.cedulaCodeudor || deudorSecundario.cedula || deudorSecundario.documento || '',
      
      // Información de notificación
      'DIRECCION_NOTIFICACION': deudorPrincipal.direccion || '',
      'DIRECCION_NOTIFICACION_2': deudorSecundario.direccion || '', // Para segundo deudor
      'DIRECCION_CODEUDOR': deudorSecundario.direccion || '',
      'TELEFONO_CODEUDOR': deudorSecundario.telefono || '',
      'EMAIL_CODEUDOR': deudorSecundario.email || '',
      'CIUDAD_CODEUDOR': deudorSecundario.ciudad || '',
      'CORREO': deudorPrincipal.email || '',
      'CORREO_2': deudorSecundario.email || '', // Para segundo deudor
      'CORREO_CODEUDOR': deudorSecundario.email || '',
      'CORREO_NOTIFICACION': deudorPrincipal.email || '',
      'EMAIL_NOTIFICACION': deudorPrincipal.email || '',
      
      // Información del proceso
      'PROCESO_ID': process.proceso_id || '',
      'NUMERO_PROCESO': process.numero_proceso || process.proceso_id || '',
      'FECHA': new Date().toLocaleDateString('es-CO'),
      'FECHA_ACTUAL': new Date().toLocaleDateString('es-CO'),
      'FECHA_DEMANDA': new Date().toLocaleDateString('es-CO'),
      
      // Información del pagaré (priorizar datos extraídos del PDF) - Múltiples variaciones
      'NUMERO_PAGARE': datosPagare.numeroPagare || process.numero_pagare || '',
      'PAGARE': datosPagare.numeroPagare || process.numero_pagare || '',
      'NUM_PAGARE': datosPagare.numeroPagare || process.numero_pagare || '', // Variación adicional
      'NO_PAGARE': datosPagare.numeroPagare || process.numero_pagare || '', // Variación adicional
      'FECHA_PAGARE': datosPagare.fechaSuscripcion || process.fecha_pagare || '',
      'FECHA_SUSCRIPCION': datosPagare.fechaSuscripcion || process.fecha_suscripcion || '',
      'SUSCRIPCION': datosPagare.fechaSuscripcion || process.fecha_suscripcion || '',
      'SUSCRIPCION_PAGARE': datosPagare.fechaSuscripcion || process.fecha_suscripcion || '',
      'FECHA_SUSCRIPCION_PAGARE': datosPagare.fechaSuscripcion || process.fecha_suscripcion || '',
      'FECHA_DE_SUSCRIPCION': datosPagare.fechaSuscripcion || process.fecha_suscripcion || '',
      'SUSCRIPCION_DEL_PAGARE': datosPagare.fechaSuscripcion || process.fecha_suscripcion || '',
      'VENCIMIENTO_PAGARE': datosPagare.fechaVencimiento || process.vencimiento_pagare || '',
      'VENCIMIENTO': datosPagare.fechaVencimiento || process.vencimiento || '',
      'FECHA_VENCIMIENTO': datosPagare.fechaVencimiento || process.fecha_vencimiento || '',
      'FECHA_MORA': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '',
      'MORA': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '',
      'FECHA_INTERESES_MORA': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '',
      'INTERESES_MORA_DESDE': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '',
      'FECHA_DE_MORA': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '',
      'INTERES_MORA': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '',
      'LUGAR_PAGARE': process.lugar_pagare || '',
      
      // Campos de capital e intereses (usar el valor formateado del PDF)
      'CAPITAL': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '',
      'CAPITAL_INSOLUTO': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '',
      
      // Información adicional
      'ABOGADO': process.abogado || '',
      'FIRMA_ABOGADO': process.firma_abogado || '',
      'TARJETA_PROFESIONAL': process.tarjeta_profesional || '',
      'APODERADO': process.apoderado || '',
      
      // Campos específicos por entidad (pueden variar)
      'PRESTAMO': process.prestamo || '',
      'CREDITO': process.credito || '',
      'OBLIGACION': process.obligacion || '',
      'TITULO': process.titulo || '',
      'DOCUMENTO': process.documento || ''
    };

    // 4. NUEVA LÓGICA: Agregar campos dinámicos según cantidad de pagarés detectada
    const cantidadPagares = detectarCantidadPagares(process);
    console.log('[getProcessMappedData] Agregando campos dinámicos para', cantidadPagares, 'pagarés');
    
    // Agregar campos numerados dinámicamente
    for (let i = 1; i <= cantidadPagares; i++) {
      // Campos de pagaré numerados
      allPossibleMappings[`PAGARE_${i}`] = datosPagare.numeroPagare || process.numero_pagare || process[`numero_pagare_${i}`] || '';
      allPossibleMappings[`VENCIMIENTO_${i}`] = datosPagare.fechaVencimiento || process.vencimiento || process[`vencimiento_${i}`] || '';
      allPossibleMappings[`CAPITAL_${i}`] = datosPagare.valorFormateado || formatearValorCompleto(process.valor || process[`valor_${i}`]) || '';
      allPossibleMappings[`INTERES_MORA_${i}`] = datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || process[`interes_mora_${i}`] || '';
      allPossibleMappings[`CAPITAL_INSOLUTO_${i}`] = datosPagare.valorFormateado || formatearValorCompleto(process.valor || process[`valor_${i}`]) || '';
      
      console.log(`[getProcessMappedData] Campos agregados para pagaré ${i}:`, {
        [`PAGARE_${i}`]: allPossibleMappings[`PAGARE_${i}`],
        [`VENCIMIENTO_${i}`]: allPossibleMappings[`VENCIMIENTO_${i}`],
        [`CAPITAL_${i}`]: allPossibleMappings[`CAPITAL_${i}`]
      });
    }
    
    // Agregar campo TOTAL si hay múltiples pagarés
    if (cantidadPagares > 1) {
      allPossibleMappings['TOTAL'] = datosPagare.valorFormateado || formatearValorCompleto(process.valor_total || process.valor) || '';
      console.log('[getProcessMappedData] Campo TOTAL agregado:', allPossibleMappings['TOTAL']);
    }

    // 5. Filtrar solo los campos que requiere la plantilla específica
    const mappedData = {};
    templateFields.forEach(field => {
      if (allPossibleMappings.hasOwnProperty(field)) {
        mappedData[field] = allPossibleMappings[field];
      } else {
        // Si no tenemos mapeo para este campo, lo dejamos vacío para que el usuario lo complete
        mappedData[field] = '';
        console.warn(`[getProcessMappedData] Campo '${field}' no tiene mapeo definido, se deja vacío`);
      }
    });
    
    // Filtrar campos con valor para el log
    const nonEmptyFields = Object.fromEntries(
      Object.entries(mappedData).filter(([key, value]) => value && value.toString().trim())
    );
    
    // Log específico para campos de codeudor si existen
    const codeudorFields = Object.fromEntries(
      Object.entries(nonEmptyFields).filter(([key, value]) => key.includes('CODEUDOR') || key.includes('_2'))
    );
    
    if (Object.keys(codeudorFields).length > 0) {
      console.log(`[getProcessMappedData] DEBUG - Campos de CODEUDOR encontrados:`, codeudorFields);
    }
    
    console.log(`[getProcessMappedData] Mapeo completado. Campos con valor (${Object.keys(nonEmptyFields).length}/${templateFields.length}):`, nonEmptyFields);
    
    return mappedData;

  } catch (error) {
    console.error('[getProcessMappedData] Error al mapear los datos del proceso:', error);
    return {};
  }
}

// Handler IPC que usa la función auxiliar
ipcMain.handle('app:getProcessMappedData', async (event, process) => {
  return await getProcessMappedData(process);
});

// NUEVO: Handler para debuggear documentos de un proceso
ipcMain.handle('app:debugProcessDocuments', async (event, processId) => {
  console.log('[debugProcessDocuments] Analizando documentos del proceso:', processId);
  
  try {
    const db = await getDBInstance();
    const processes = db.getAllProcesses();
    const process = processes.find(p => p.proceso_id === processId);
    
    if (!process) {
      return {
        success: false,
        error: 'Proceso no encontrado',
        processId: processId
      };
    }
    
    const documentInfo = {
      processId: processId,
      cliente: process.cliente?.razon || 'NO ESPECIFICADO',
      documentos: {},
      cantidadPagares: detectarCantidadPagares(process),
      estructura: {
        tieneDocumentos: !!process.documentos,
        cantidadDocumentos: process.documentos ? Object.keys(process.documentos).length : 0,
        tiposDocumentos: process.documentos ? Object.keys(process.documentos) : []
      }
    };
    
    // Analizar cada documento si existen
    if (process.documentos) {
      for (const [docKey, docData] of Object.entries(process.documentos)) {
        documentInfo.documentos[docKey] = {
          existe: true,
          filename: docData.filename || 'NO ESPECIFICADO',
          content_type: docData.content_type || 'NO ESPECIFICADO',
          hasBase64: !!docData.base64,
          hasData: !!docData.data,
          base64Length: docData.base64 ? docData.base64.length : 0,
          dataLength: docData.data ? docData.data.length : 0,
          esPagare: docKey.toLowerCase().includes('pagare')
        };
      }
    }
    
    console.log('[debugProcessDocuments] Información de documentos:', documentInfo);
    
    return {
      success: true,
      data: documentInfo
    };
    
  } catch (error) {
    console.error('[debugProcessDocuments] Error:', error);
    return {
      success: false,
      error: error.message,
      processId: processId
    };
  }
});

// Función auxiliar para mapear datos de portada (similar a getProcessMappedData)
async function getProcessCoverMappedData(process) {
  console.log('[getProcessCoverMappedData] Iniciando mapeo de portada para el proceso:', process.proceso_id);
  console.log('[getProcessCoverMappedData] Cliente:', process.cliente?.razon);
  
  try {
    // 1. Obtener los campos requeridos por la plantilla de portada de esta entidad
    const clientName = process.cliente?.razon || '';
    let coverFields = [];
    
    // Obtener campos de la plantilla de portada
    try {
      if (clientName) {
        const normalizedClientName = clientName.toLowerCase()
          .replace(/\./g, '')
          .replace(/\s+/g, '')
          .replace(/[^a-z0-9]/g, '');
        
        const coversDir = path.join(__dirname, 'formatos', 'Portadas');
        const files = await fs.readdir(coversDir);
        
        // Buscar archivo de portada - Búsqueda más flexible
        let coverFile = null;
        
        // Estrategia 1: Buscar por nombre exacto normalizado
        coverFile = files.find(file => {
          const normalizedFileName = file.toLowerCase()
            .replace(/\./g, '')
            .replace(/\s+/g, '')
            .replace(/[^a-z0-9]/g, '');
          const normalizedSearch = normalizedClientName;
          console.log(`[getProcessCoverMappedData] Comparando: "${normalizedFileName}" contiene "portada"? ${normalizedFileName.includes('portada')} y "${normalizedSearch}"? ${normalizedFileName.includes(normalizedSearch)}`);
          return normalizedFileName.includes('portada') && 
                 normalizedFileName.includes(normalizedSearch) && 
                 file.endsWith('.docx');
        });
        
        console.log(`[getProcessCoverMappedData] Búsqueda inicial resultado: ${coverFile || 'NO ENCONTRADO'}`);
        
        // Estrategia 2: Buscar por palabras clave más flexibles
        if (!coverFile && clientName) {
          console.log(`[getProcessCoverMappedData] Intentando fallback con palabras clave...`);
          const keywords = clientName.toLowerCase().split(/\s+/);
          console.log(`[getProcessCoverMappedData] Palabras clave: ${keywords.join(', ')}`);
          
          coverFile = files.find(file => {
            const lowerFile = file.toLowerCase();
            const hasPortada = lowerFile.includes('portada');
            const hasKeyword = keywords.some(keyword => {
              const match = keyword.length > 2 && lowerFile.includes(keyword.toLowerCase());
              console.log(`[getProcessCoverMappedData] Archivo "${file}" - palabra "${keyword}": ${match}`);
              return match;
            });
            console.log(`[getProcessCoverMappedData] Archivo "${file}" - tiene portada: ${hasPortada}, tiene keyword: ${hasKeyword}`);
            return hasPortada && hasKeyword && file.endsWith('.docx');
          });
        }
        
        // Estrategia 3: Buscar por coincidencia parcial más amplia
        if (!coverFile && clientName) {
          console.log(`[getProcessCoverMappedData] Intentando búsqueda parcial amplia...`);
          coverFile = files.find(file => {
            const lowerFile = file.toLowerCase();
            const lowerClient = clientName.toLowerCase();
            
            // Buscar si cualquier parte del nombre del cliente aparece en el archivo
            const hasPortada = lowerFile.includes('portada');
            const hasPartialMatch = lowerClient.length >= 4 && lowerFile.includes(lowerClient.substring(0, 4));
            
            console.log(`[getProcessCoverMappedData] Archivo "${file}" - búsqueda amplia - portada: ${hasPortada}, coincidencia parcial: ${hasPartialMatch}`);
            return hasPortada && hasPartialMatch && file.endsWith('.docx');
          });
        }
        
        console.log(`[getProcessCoverMappedData] Resultado final: ${coverFile || 'NO ENCONTRADO'}`);
        
        // Fallback final: usar cualquier portada disponible para debugging
        if (!coverFile) {
          console.warn(`[getProcessCoverMappedData] No se encontró portada específica, usando primera disponible para debugging`);
          coverFile = files.find(file => file.toLowerCase().includes('portada') && file.endsWith('.docx'));
          console.log(`[getProcessCoverMappedData] Fallback final: ${coverFile || 'NINGUNA PORTADA ENCONTRADA'}`);
        }
        
        if (coverFile) {
          const coverPath = path.join(coversDir, coverFile);
          const content = await fs.readFile(coverPath);
          const zip = new PizZip(content);
          const doc = new Docxtemplater(zip, {
            delimiters: { start: '«', end: '»' },
            paragraphsLoop: true,
            linebreaks: true,
            modules: [iModule]
          });
          doc.render();
          const tags = iModule.getAllTags();
          coverFields = Object.keys(tags);
          console.log('[getProcessCoverMappedData] Campos encontrados en plantilla de portada:', coverFields);
        }
      }
    } catch (templateError) {
      console.warn('[getProcessCoverMappedData] Error al leer plantilla de portada:', templateError.message);
    }
    
    if (coverFields.length === 0) {
      console.warn('[getProcessCoverMappedData] No se encontraron campos de plantilla de portada para:', clientName);
      // Usar campos básicos de portada más comunes según las plantillas inspeccionadas
      coverFields = ['JUZGADO', 'DOMICILIO', 'CUANTIA', 'DEMANDADO_1'];
      console.log('[getProcessCoverMappedData] Usando campos básicos de portada:', coverFields);
    }
    
    // 2. Preparar datos del proceso
    let deudores = [];
    if (process.deudores && Array.isArray(process.deudores)) {
        deudores = process.deudores;
    } else if (process.deudor) {
        deudores = [process.deudor];
    }

    const cliente = process.cliente || {};
    const deudorPrincipal = deudores.length > 0 ? deudores[0] : {};
    const deudorSecundario = deudores.length > 1 ? deudores[1] : {};

    // 3. Extraer datos del PDF pagaré si está disponible (igual que en demandas)
    let datosPagare = {};
    try {
      if (process.documentos && process.documentos.pagare) {
        const pdfData = process.documentos.pagare.base64 || process.documentos.pagare.data;
        if (pdfData) {
          datosPagare = await extraerDatosPagare(pdfData);
        }
      }
    } catch (error) {
      console.warn('[getProcessCoverMappedData] Error al extraer datos del pagaré:', error.message);
    }

    // 4. Mapeo específico para portadas - campos típicos de portada (más simples que demandas)
    const allPossibleCoverMappings = {
      // Información del juzgado (campo común en portadas)
      'JUZGADO': process.juzgado_origen || process.juzgado || 'Juzgado Civil Municipal',
      
      // Domicilio (diferente a ciudad, más específico para portadas)
      'DOMICILIO': deudorPrincipal.ciudad || process.ciudad || cliente.ciudad || 'Bogotá D.C.',
      
      // Cuantía (calcular automáticamente basado en el valor)
      'CUANTIA': calcularCuantia(datosPagare.valor || process.valor) || process.cuantia || 'MÍNIMA',
      
      // Demandados (hasta 3 como se ve en las plantillas) - priorizar datos del PDF
      'DEMANDADO_1': datosPagare.deudorCompleto || formatearNombreConCC(deudorPrincipal.nombre, deudorPrincipal.cedula || deudorPrincipal.documento),
      'DEMANDADO_2': datosPagare.codeudorCompleto || formatearNombreConCC(deudorSecundario.nombre, deudorSecundario.cedula || deudorSecundario.documento),
      'DEMANDADO_3': deudores.length > 2 ? formatearNombreConCC(deudores[2].nombre, deudores[2].cedula || deudores[2].documento) : '',
      
      // Campos adicionales que podrían aparecer en algunas portadas
      'DEMANDADO': deudorPrincipal.nombre || '',
      'DEMANDANTE': cliente.razon || cliente.nombre || '',
      'CLIENTE': cliente.razon || cliente.nombre || '',
      'ENTIDAD': cliente.razon || cliente.nombre || '',
      'CIUDAD': process.ciudad || deudorPrincipal.ciudad || cliente.ciudad || 'Bogotá D.C.',
      'MUNICIPIO': process.ciudad || deudorPrincipal.ciudad || cliente.ciudad || 'Bogotá D.C.',
      'FECHA': new Date().toLocaleDateString('es-CO'),
      'FECHA_ACTUAL': new Date().toLocaleDateString('es-CO'),
      'PROCESO_ID': process.proceso_id || '',
      'NUMERO_PROCESO': process.numero_proceso || process.proceso_id || '',
      'EXPEDIENTE': process.numero_proceso || process.proceso_id || '',
      'VALOR': datosPagare.valorFormateado || formatearValorCompleto(process.valor || process.cuantia) || process.valor || process.cuantia || '',
      'MONTO': datosPagare.valorFormateado || formatearValorCompleto(process.monto || process.valor || process.cuantia) || process.monto || process.valor || process.cuantia || '',
      'ABOGADO': process.abogado || '',
      'APODERADO': process.apoderado || '',
      
      // Información del pagaré (campos que pueden aparecer en portadas)
      'PAGARE': datosPagare.numeroPagare || process.numero_pagare || '',
      'PAGARE_2': datosPagare.numeroPagare || process.numero_pagare || '', // Mismo número para segundo pagaré
      'PAGARE_3': datosPagare.numeroPagare || process.numero_pagare || '', // Mismo número para tercer pagaré
      'NUMERO_PAGARE': datosPagare.numeroPagare || process.numero_pagare || '',
      'FECHA_SUSCRIPCION': datosPagare.fechaSuscripcion || process.fecha_suscripcion || '',
      'SUSCRIPCION': datosPagare.fechaSuscripcion || process.fecha_suscripcion || '',
      'FECHA_DE_SUSCRIPCION': datosPagare.fechaSuscripcion || process.fecha_suscripcion || '',
      'SUSCRIPCION_DEL_PAGARE': datosPagare.fechaSuscripcion || process.fecha_suscripcion || '',
      'VENCIMIENTO': datosPagare.fechaVencimiento || process.vencimiento || '',
      'VENCIMIENTO_2': datosPagare.fechaVencimiento || process.vencimiento || '', // Misma fecha para segundo vencimiento
      'VENCIMIENTO_3': datosPagare.fechaVencimiento || process.vencimiento || '', // Misma fecha para tercer vencimiento
      'FECHA_VENCIMIENTO': datosPagare.fechaVencimiento || process.fecha_vencimiento || '',
      'FECHA_MORA': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '',
      'FECHA_DE_MORA': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '',
      'MORA': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '',
      'CAPITAL': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '',
      'CAPITAL_2': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '', // Mismo valor para segundo capital
      'CAPITAL_INSOLUTO': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '',
      'CAPITAL_INSOLUTO_2': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '', // Mismo valor para segundo capital
      'CAPITAL_INSOLUTO_3': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '', // Mismo valor para tercer capital
      'INTERES_MORA': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '', // Campo para fecha de intereses de mora
      'INTERES_MORA_2': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '', // Misma fecha para segundo interés
      'INTERES_MORA_3': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '', // Misma fecha para tercer interés
      'DIRECCION_NOTIFICACION': deudorPrincipal.direccion || '',
      'DIRECCION_NOTIFICACION_2': deudorSecundario.direccion || '',
      'CORREO': deudorPrincipal.email || '',
      'CORREO_2': deudorSecundario.email || '',
      
      // Campos específicos de codeudor (priorizando datos del PDF)
      'DEUDOR_2': datosPagare.codeudorCompleto || formatearNombreConCC(deudorSecundario.nombre, deudorSecundario.cedula || deudorSecundario.documento),
      'CODEUDOR': datosPagare.codeudorCompleto || formatearNombreConCC(deudorSecundario.nombre, deudorSecundario.cedula || deudorSecundario.documento),
      'NOMBRE_CODEUDOR': datosPagare.codeudorCompleto || formatearNombreConCC(deudorSecundario.nombre, deudorSecundario.cedula || deudorSecundario.documento),
      'NOMBRES_CODEUDOR': datosPagare.codeudorCompleto || formatearNombreConCC(deudorSecundario.nombre, deudorSecundario.cedula || deudorSecundario.documento),
      'CEDULA_CODEUDOR': datosPagare.cedulaCodeudor || deudorSecundario.cedula || deudorSecundario.documento || '',
      'DOCUMENTO_CODEUDOR': datosPagare.cedulaCodeudor || deudorSecundario.cedula || deudorSecundario.documento || '',
      'CC_CODEUDOR': datosPagare.cedulaCodeudor || deudorSecundario.cedula || deudorSecundario.documento || '',
      'DIRECCION_CODEUDOR': deudorSecundario.direccion || '',
      'TELEFONO_CODEUDOR': deudorSecundario.telefono || '',
      'EMAIL_CODEUDOR': deudorSecundario.email || '',
      'CORREO_CODEUDOR': deudorSecundario.email || '',
      'CIUDAD_CODEUDOR': deudorSecundario.ciudad || ''
    };

    // 5. Filtrar solo los campos que requiere la plantilla de portada específica
    const coverMappedData = {};
    coverFields.forEach(field => {
      if (allPossibleCoverMappings.hasOwnProperty(field)) {
        coverMappedData[field] = allPossibleCoverMappings[field];
      } else {
        // Si no tenemos mapeo para este campo, lo dejamos vacío
        coverMappedData[field] = '';
        console.warn(`[getProcessCoverMappedData] Campo de portada '${field}' no tiene mapeo definido, se deja vacío`);
      }
    });
    
    // Filtrar campos con valor para el log
    const nonEmptyFields = Object.fromEntries(
      Object.entries(coverMappedData).filter(([key, value]) => value && value.toString().trim())
    );
    
    console.log(`[getProcessCoverMappedData] Mapeo de portada completado. Campos con valor (${Object.keys(nonEmptyFields).length}/${coverFields.length}):`, nonEmptyFields);
    
    return coverMappedData;

  } catch (error) {
    console.error('[getProcessCoverMappedData] Error al mapear los datos de portada del proceso:', error);
    return {};
  }
}

// Handler IPC que usa la función auxiliar de portada
ipcMain.handle('app:getProcessCoverMappedData', async (event, process) => {
  return await getProcessCoverMappedData(process);
});

// Diligenciar una portada con los datos de un proceso
ipcMain.handle('app:diligenciarPortada', async (event, proceso) => {
  console.log('[diligenciarPortada] Iniciando diligenciamiento de portada para proceso:', proceso.proceso_id);
  console.log('[diligenciarPortada] Cliente:', proceso.cliente?.razon);
  
  try {
    // 1. Verificar si hay datos editados en la base de datos PRIMERO
    console.log('[diligenciarPortada] Verificando datos editados en base de datos...');
    const db = await getDBInstance();
    const cachedData = db.getMappedData(proceso.proceso_id);
    
    let mappedData;
    if (Object.keys(cachedData).length > 0) {
      console.log('[diligenciarPortada] Usando datos editados de la base de datos');
      mappedData = cachedData;
    } else {
      console.log('[diligenciarPortada] Obteniendo datos mapeados frescos de portada...');
      mappedData = await getProcessCoverMappedData(proceso);
    }
    
    console.log('[diligenciarPortada] Datos mapeados de portada obtenidos:', mappedData);
    
    // 2. Buscar el formato de portada correspondiente
    const clientName = proceso.cliente?.razon || '';
    console.log('[diligenciarPortada] Buscando formato de portada para cliente:', clientName);
    
    const templatesDir = path.join(__dirname, 'formatos', 'Portadas');
    const files = await fs.readdir(templatesDir);
    console.log('[diligenciarPortada] Archivos de portada disponibles:', files);
    
    // Normalizar el nombre del cliente para búsqueda más flexible
    const normalizedClientName = clientName.toLowerCase()
      .replace(/\./g, '')
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
    
    console.log('[diligenciarPortada] Nombre normalizado:', normalizedClientName);
    
    // Buscar el archivo de formato correspondiente
    let templateFile = null;
    
    // Estrategia 1: Buscar archivo que contenga el nombre normalizado y "portada"
    templateFile = files.find(file => {
      const normalizedFileName = file.toLowerCase()
        .replace(/\./g, '')
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/g, '');
      return normalizedFileName.includes('portada') && 
             normalizedFileName.includes(normalizedClientName) && 
             file.endsWith('.docx');
    });
    
    // Estrategia 2: Buscar por palabras clave del nombre
    if (!templateFile && clientName) {
      const keywords = clientName.toLowerCase().split(/\s+/);
      templateFile = files.find(file => {
        const lowerFile = file.toLowerCase();
        return lowerFile.includes('portada') && 
               keywords.some(keyword => 
                 keyword.length > 2 && 
                 lowerFile.includes(keyword.toLowerCase())
               ) && 
               file.endsWith('.docx');
      });
    }
    
    // Estrategia 3: Usar la primera portada disponible como fallback
    if (!templateFile) {
      templateFile = files.find(file => file.toLowerCase().includes('portada') && file.endsWith('.docx') && !file.startsWith('~$'));
      console.warn('[diligenciarPortada] No se encontró portada específica, usando fallback:', templateFile);
    }
    
    if (!templateFile) {
      console.error('[diligenciarPortada] No se encontró ninguna portada para:', clientName);
      return { 
        success: false, 
        message: `No se encontró formato de portada para "${clientName}". Archivos disponibles: ${files.join(', ')}` 
      };
    }
    
    console.log('[diligenciarPortada] Formato de portada seleccionado:', templateFile);
    const templatePath = path.join(templatesDir, templateFile);
    
    // 3. Cargar y procesar el documento Word de portada
    const content = await fs.readFile(templatePath);
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      delimiters: {
        start: '«',
        end: '»'
      },
      paragraphsLoop: true,
      linebreaks: true,
      modules: [iModule]
    });
    
    // 4. Renderizar el documento con los datos
    console.log('[diligenciarPortada] Renderizando portada con datos:', mappedData);
    doc.render(mappedData);
    
    // 5. Generar el archivo de salida
    const outputBuffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE'
    });
    
    // 6. Guardar el archivo en la carpeta de Documentos del usuario
    const documentsPath = app.getPath('documents');
    const outputDir = path.join(documentsPath, 'Portadas_Staffbot');
    await fs.mkdir(outputDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputFileName = `Portada_${proceso.proceso_id}_${timestamp}.docx`;
    const outputPath = path.join(outputDir, outputFileName);
    
    await fs.writeFile(outputPath, outputBuffer);
    
    console.log('[diligenciarPortada] Portada generada exitosamente:', outputPath);
    
    // 7. Convertir el documento a HTML para previsualización
    try {
      const htmlResult = await mammoth.convertToHtml({ buffer: outputBuffer });
      const htmlContent = htmlResult.value;
      
      console.log('[diligenciarPortada] HTML de portada generado exitosamente');
      
      return { 
        success: true, 
        message: 'Portada generada exitosamente',
        filePath: outputPath,
        fileName: outputFileName,
        htmlContent: htmlContent
      };
    } catch (htmlError) {
      console.error('[diligenciarPortada] Error al generar HTML de portada:', htmlError);
      return { 
        success: true, 
        message: 'Portada generada exitosamente (sin previsualización)',
        filePath: outputPath,
        fileName: outputFileName,
        htmlContent: '<p>Error al generar previsualización</p>'
      };
    }
    
  } catch (error) {
    console.error('[diligenciarPortada] Error al generar portada:', error);
    return { 
      success: false, 
      message: `Error al generar portada: ${error.message}` 
    };
  }
});

// Diligenciar una demanda con los datos de un proceso
ipcMain.handle('app:diligenciarDemanda', async (event, proceso) => {
  console.log('[diligenciarDemanda] Iniciando diligenciamiento para proceso:', proceso.proceso_id);
  console.log('[diligenciarDemanda] Cliente:', proceso.cliente?.razon);
  
  try {
    // 1. Obtener los datos mapeados del proceso usando la función existente que incluye extracción de PDF
    console.log('[diligenciarDemanda] Obteniendo datos mapeados con extracción de PDF...');
    const mappedData = await getProcessMappedData(proceso);
    
    console.log('[diligenciarDemanda] Datos mapeados obtenidos:', mappedData);
    
    // 2. Buscar el formato de demanda correspondiente usando lógica inteligente
    const clientName = proceso.cliente?.razon || '';
    console.log('[diligenciarDemanda] Buscando formato para cliente:', clientName);
    
    const templatesDir = path.join(__dirname, 'formatos', 'demandas');
    const files = await fs.readdir(templatesDir);
    console.log('[diligenciarDemanda] Archivos disponibles:', files);
    
    // NUEVA LÓGICA: Detectar cantidad de pagarés y buscar plantilla apropiada
    const cantidadPagares = detectarCantidadPagares(proceso);
    console.log('[diligenciarDemanda] Cantidad de pagarés detectada:', cantidadPagares);
    
    let templateFile = buscarPlantillaConPagares(files, clientName, cantidadPagares);
    
    // Fallback a la lógica original si no se encontró con la nueva lógica
    if (!templateFile) {
      console.log('[diligenciarDemanda] Plantilla inteligente no encontrada, usando lógica original');
    
    // Normalizar el nombre del cliente para búsqueda más flexible
    const normalizedClientName = clientName.toLowerCase()
      .replace(/\./g, '')
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
    
    console.log('[diligenciarDemanda] Nombre normalizado:', normalizedClientName);
    
    // Estrategia 1: Buscar archivo que empiece con el nombre normalizado
    templateFile = files.find(file => {
      const normalizedFileName = file.toLowerCase()
        .replace(/\./g, '')
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/g, '');
      return normalizedFileName.startsWith(normalizedClientName) && file.endsWith('.docx');
    });
    
    // Estrategia 2: Buscar por palabras clave del nombre (que empiecen con la palabra)
    if (!templateFile && clientName) {
      const keywords = clientName.toLowerCase().split(/\s+/);
      templateFile = files.find(file => {
        const lowerFile = file.toLowerCase();
        return keywords.some(keyword => 
          keyword.length > 2 && 
          lowerFile.startsWith(keyword.toLowerCase()) && 
          file.endsWith('.docx')
        );
      });
    }
    
    // Estrategia 3: Usar el primer archivo disponible como fallback
    if (!templateFile) {
      templateFile = files.find(file => file.endsWith('.docx') && !file.startsWith('~$'));
      console.warn('[diligenciarDemanda] No se encontró formato específico, usando fallback:', templateFile);
      }
    }
    
    if (!templateFile) {
      console.error('[diligenciarDemanda] No se encontró ningún formato para:', clientName);
      return { 
        success: false, 
        message: `No se encontró formato de demanda para "${clientName}". Archivos disponibles: ${files.join(', ')}` 
      };
    }
    
    console.log('[diligenciarDemanda] Formato seleccionado:', templateFile);
    const templatePath = path.join(templatesDir, templateFile);
    
    // 3. Cargar y procesar el documento Word
    const content = await fs.readFile(templatePath);
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      delimiters: {
        start: '«',
        end: '»'
      },
      paragraphsLoop: true,
      linebreaks: true,
      modules: [iModule]
    });
    
    // 4. Renderizar el documento con los datos
    console.log('[diligenciarDemanda] Renderizando documento con datos:', mappedData);
    doc.render(mappedData);
    
    // 5. Generar el archivo de salida
    const outputBuffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE'
    });
    
    // 6. Guardar el archivo en la carpeta de Documentos del usuario
    const documentsPath = app.getPath('documents');
    const outputDir = path.join(documentsPath, 'Demandas_Staffbot');
    await fs.mkdir(outputDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputFileName = `Demanda_${proceso.proceso_id}_${timestamp}.docx`;
    const outputPath = path.join(outputDir, outputFileName);
    
    await fs.writeFile(outputPath, outputBuffer);
    
    console.log('[diligenciarDemanda] Documento generado exitosamente:', outputPath);
    
    // 7. Convertir el documento a HTML para previsualización
    try {
      const htmlResult = await mammoth.convertToHtml({ buffer: outputBuffer });
      const htmlContent = htmlResult.value;
      
      // Resaltar los campos que fueron reemplazados con lógica mejorada
      let highlightedHtml = htmlContent;
      
      // Crear lista de valores para resaltar con diferentes estrategias
      const valoresParaResaltar = [];
      
      Object.keys(mappedData).forEach(key => {
        const value = mappedData[key];
        if (value && value.toString().trim()) {
          const valorStr = value.toString().trim();
          
          // Estrategia 1: Valor completo (para textos cortos)
          if (valorStr.length < 100) {
            valoresParaResaltar.push({
              key: key,
              value: valorStr,
              regex: new RegExp(`\\b${valorStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
            });
          }
          
          // Estrategia 2: Para números de pagaré (buscar solo el número)
          if (key.includes('PAGARE') && valorStr.match(/^\d+$/)) {
            valoresParaResaltar.push({
              key: key,
              value: valorStr,
              regex: new RegExp(`\\b${valorStr}\\b`, 'gi')
            });
          }
          
          // Estrategia 3: Para valores monetarios largos, buscar partes clave
          if (valorStr.includes('PESOS M/CTE')) {
            // Extraer solo la parte en números para resaltar
            const numeroMatch = valorStr.match(/\$\s*([\d,\.]+)/);
            if (numeroMatch) {
              valoresParaResaltar.push({
                key: key,
                value: numeroMatch[0], // ej: "$ 12.916.682"
                regex: new RegExp(`\\${numeroMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi')
              });
            }
            
            // También buscar la parte en letras (primeras palabras)
            const letrasMatch = valorStr.match(/^([A-Z\s]+)(?=\sPESOS)/);
            if (letrasMatch && letrasMatch[1].length > 10) {
              valoresParaResaltar.push({
                key: key,
                value: letrasMatch[1].trim(),
                regex: new RegExp(`${letrasMatch[1].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi')
              });
            }
          }
          
          // Estrategia 4: Para nombres con CC, buscar también solo el nombre
          if (valorStr.includes(' con C.C ')) {
            const nombreSolo = valorStr.split(' con C.C ')[0];
            valoresParaResaltar.push({
              key: key,
              value: nombreSolo,
              regex: new RegExp(`\\b${nombreSolo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
            });
          }
          
          // Estrategia 5: Para fechas
          if (valorStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
            valoresParaResaltar.push({
              key: key,
              value: valorStr,
              regex: new RegExp(`\\b${valorStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
            });
          }
        }
      });
      
      // Aplicar resaltado para cada valor, evitando duplicados
      const yaResaltado = new Set();
      valoresParaResaltar.forEach(item => {
        if (!yaResaltado.has(item.value)) {
          highlightedHtml = highlightedHtml.replace(item.regex, `<mark class="field-highlight" data-field="${item.key}" style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 2px; cursor: pointer;" title="Campo: ${item.key}">${item.value}</mark>`);
          yaResaltado.add(item.value);
        }
      });
      
      console.log('[diligenciarDemanda] HTML generado exitosamente');
      
      return {
        success: true,
        message: 'Demanda diligenciada exitosamente',
        filePath: outputPath,
        fileName: outputFileName,
        data: mappedData,
        htmlContent: highlightedHtml
      };
      
    } catch (htmlError) {
      console.warn('[diligenciarDemanda] Error al generar HTML, pero documento Word creado:', htmlError);
      return {
        success: true,
        message: 'Demanda diligenciada exitosamente (sin previsualización)',
        filePath: outputPath,
        fileName: outputFileName,
        data: mappedData,
        htmlContent: '<p>Error al generar previsualización. El documento Word fue creado correctamente.</p>'
      };
    }
    
  } catch (error) {
    console.error('[diligenciarDemanda] Error al diligenciar demanda:', error);
    return {
      success: false,
      message: `Error al diligenciar demanda: ${error.message}`,
      error: error.toString()
    };
  }
});

// Función para actualizar los datos mapeados de un proceso (usando SQLite)
ipcMain.handle('app:updateMappedData', async (event, processId, updatedMappedData) => {
  console.log('[updateMappedData] Actualizando datos para proceso:', processId);
  console.log('[updateMappedData] Datos recibidos:', updatedMappedData);
  
  try {
    const db = await getDBInstance();
    const result = db.updateMappedData(processId, updatedMappedData);
    
    if (result.success) {
      console.log(`[updateMappedData] Datos guardados en base de datos para proceso ${processId}`);
      return {
        success: true,
        message: 'Datos actualizados exitosamente en base de datos',
        processId: processId,
        fieldsUpdated: Object.keys(updatedMappedData).length
      };
    } else {
      console.error('[updateMappedData] Error al guardar en base de datos:', result.error);
      return {
        success: false,
        message: `Error al actualizar datos: ${result.error}`,
        error: result.error
      };
    }
    
  } catch (error) {
    console.error('[updateMappedData] Error al actualizar datos:', error);
    return {
      success: false,
      message: `Error al actualizar datos: ${error.message}`,
      error: error.toString()
    };
  }
});

// --- CLASE Y MANEJADORES GENÉRICOS DE PDF ---
class PDFManager {
  
  static async base64ToPDF(base64String, outputPath) {
    try {
      let cleanBase64 = base64String;
      if (base64String.startsWith('data:')) {
        cleanBase64 = base64String.split(',')[1];
      }
      const pdfBuffer = Buffer.from(cleanBase64, 'base64');
      await fs.writeFile(outputPath, pdfBuffer);
      return { success: true, message: 'PDF guardado exitosamente', filePath: outputPath };
    } catch (error) {
      return { success: false, message: `Error al convertir base64 a PDF: ${error.message}` };
    }
  }

  static async getFileInfo(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return { success: true, fileName: path.basename(filePath), filePath: filePath, fileSize: stats.size };
    } catch (error) {
      return { success: false, message: `Error al obtener información del archivo: ${error.message}` };
    }
  }
}

ipcMain.handle('pdf:base64ToPdf', async (event, base64String, outputPath) => {
  return await PDFManager.base64ToPDF(base64String, outputPath);
});

ipcMain.handle('pdf:getFileInfo', async (event, filePath) => {
  return await PDFManager.getFileInfo(filePath);
});

ipcMain.handle('dialog:saveFile', async (event, defaultName = 'documento.pdf') => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'Todos los archivos', extensions: ['*'] }]
  });
  return { success: !result.canceled, filePath: result.filePath || null };
});

ipcMain.handle('shell:openFile', (event, filePath) => shell.openPath(filePath));
ipcMain.handle('app:getDocumentsPath', () => app.getPath('documents'));

process.on('uncaughtException', (error) => {
  console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Rechazo no manejado en:', promise, 'razón:', reason);
});

// === FUNCIONES DE EXTRACCIÓN Y FORMATEO DE DATOS ===

// Función para convertir número a letras
function numeroALetras(numero) {
  const unidades = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const decenas = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const especiales = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
  const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
  
  if (numero === 0) return 'CERO';
  if (numero === 100) return 'CIEN';
  
  let resultado = '';
  
  // Millones
  if (numero >= 1000000) {
    const millones = Math.floor(numero / 1000000);
    if (millones === 1) {
      resultado += 'UN MILLON ';
    } else {
      resultado += numeroALetras(millones) + ' MILLONES ';
    }
    numero = numero % 1000000;
  }
  
  // Miles
  if (numero >= 1000) {
    const miles = Math.floor(numero / 1000);
    if (miles === 1) {
      resultado += 'MIL ';
    } else {
      resultado += numeroALetras(miles) + ' MIL ';
    }
    numero = numero % 1000;
  }
  
  // Centenas
  if (numero >= 100) {
    const centena = Math.floor(numero / 100);
    resultado += centenas[centena] + ' ';
    numero = numero % 100;
  }
  
  // Decenas y unidades
  if (numero >= 20) {
    const decena = Math.floor(numero / 10);
    resultado += decenas[decena];
    numero = numero % 10;
    if (numero > 0) {
      resultado += ' Y ' + unidades[numero];
    }
  } else if (numero >= 10) {
    resultado += especiales[numero - 10];
  } else if (numero > 0) {
    resultado += unidades[numero];
  }
  
  return resultado.trim();
}

// Función para formatear valor en números y letras
function formatearValorCompleto(valor) {
  if (!valor) return '';
  const numeroLimpio = parseFloat(valor.toString().replace(/[^\d.]/g, ''));
  if (isNaN(numeroLimpio)) return valor;
  
  const valorEnLetras = numeroALetras(Math.floor(numeroLimpio));
  const valorFormateado = numeroLimpio.toLocaleString('es-CO');
  
  return `${valorEnLetras} PESOS M/CTE ($ ${valorFormateado})`;
}

// Función para calcular fecha de mora (1 día después del vencimiento)
function calcularFechaMora(fechaVencimiento) {
  if (!fechaVencimiento) return '';
  
  try {
    // Parsear la fecha de vencimiento (formato DD/MM/YYYY)
    const partes = fechaVencimiento.split('/');
    if (partes.length !== 3) {
      console.warn('Formato de fecha inválido para calcular mora:', fechaVencimiento);
      return '';
    }
    
    const dia = parseInt(partes[0]);
    const mes = parseInt(partes[1]);
    const año = parseInt(partes[2]);
    
    // Validar que los valores sean números válidos
    if (isNaN(dia) || isNaN(mes) || isNaN(año)) {
      console.warn('Valores de fecha inválidos:', { dia, mes, año });
      return '';
    }
    
    const fecha = new Date(año, mes - 1, dia); // mes - 1 porque Date usa 0-11 para meses
    
    // Validar que la fecha sea válida
    if (isNaN(fecha.getTime())) {
      console.warn('Fecha inválida creada:', fecha);
      return '';
    }
    
    // Agregar 1 día para fecha de mora (intereses)
    fecha.setDate(fecha.getDate() + 1);
    
    // Formatear de vuelta a DD/MM/YYYY
    const diaFormateado = fecha.getDate().toString().padStart(2, '0');
    const mesFormateado = (fecha.getMonth() + 1).toString().padStart(2, '0');
    const añoFormateado = fecha.getFullYear();
    
    return `${diaFormateado}/${mesFormateado}/${añoFormateado}`;
  } catch (error) {
    console.error('Error calculando fecha de mora:', error);
    return '';
  }
}

// Función para calcular cuantía basada en el valor del proceso
function calcularCuantia(valor) {
  if (!valor) return 'MÍNIMA';
  
  // Convertir a número si es string
  let valorNumerico;
  if (typeof valor === 'string') {
    // Limpiar el string: remover símbolos y convertir puntos/comas de separadores de miles
    let valorLimpio = valor.replace(/[^\d.,]/g, ''); // Solo dígitos, puntos y comas
    
    // Si tiene formato colombiano (puntos como separadores de miles y coma decimal)
    // Ej: "71.061.959,00" -> "71061959.00"
    if (valorLimpio.includes('.') && valorLimpio.includes(',')) {
      valorLimpio = valorLimpio.replace(/\./g, '').replace(',', '.');
    }
    // Si tiene formato internacional con comas como separadores de miles y punto decimal
    // Ej: "71,061,959.00" -> "71061959.00"
    else if (valorLimpio.includes(',') && valorLimpio.includes('.')) {
      const partes = valorLimpio.split('.');
      if (partes.length === 2 && partes[1].length <= 2) {
        // El punto es decimal, las comas son separadores de miles
        valorLimpio = valorLimpio.replace(/,/g, '');
      } else {
        // Tratar todo como separadores de miles
        valorLimpio = valorLimpio.replace(/[,.]/g, '');
      }
    }
    // Si solo tiene puntos (formato internacional o separadores de miles)
    // Ej: "71.061.959" -> "71061959"
    else if (valorLimpio.includes('.')) {
      const partes = valorLimpio.split('.');
      if (partes.length > 2) {
        // Múltiples puntos = separadores de miles
        valorLimpio = valorLimpio.replace(/\./g, '');
      }
      // Si solo hay un punto y la parte decimal tiene más de 2 dígitos, probablemente son separadores de miles
      else if (partes[1] && partes[1].length > 2) {
        valorLimpio = valorLimpio.replace(/\./g, '');
      }
    }
    // Si solo tiene comas, tratarlas como separadores de miles
    // Ej: "71,061,959" -> "71061959"
    else if (valorLimpio.includes(',')) {
      const partes = valorLimpio.split(',');
      if (partes.length > 2) {
        valorLimpio = valorLimpio.replace(/,/g, '');
      }
    }
    
    valorNumerico = parseFloat(valorLimpio);
  } else {
    valorNumerico = valor;
  }
  
  if (isNaN(valorNumerico)) return 'MÍNIMA';
  
  // Valores límite basados en SMLMV 2024/2025
  const LIMITE_MINIMA = 56940000;    // 40 SMLMV
  const LIMITE_MENOR = 213525000;    // 150 SMLMV
  
  if (valorNumerico <= LIMITE_MINIMA) {
    return 'MÍNIMA';
  } else if (valorNumerico <= LIMITE_MENOR) {
    return 'MENOR';
  } else {
    return 'MAYOR';
  }
}

// Función para formatear nombre con cédula
function formatearNombreConCC(nombre, cedula) {
  if (!nombre) return '';
  if (!cedula) return nombre;
  
  return `${nombre} con C.C ${cedula}`;
}

// Función para extraer datos del PDF pagaré
async function extraerDatosPagare(pdfBase64) {
  console.log('[extraerDatosPagare] Iniciando extracción de datos del pagaré');
  
  try {
    if (!pdfBase64) {
      console.warn('[extraerDatosPagare] No se recibió contenido del PDF');
      return {};
    }

    // Convertir base64 a buffer
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    
    // Extraer texto del PDF usando pdf-parse
    const data = await pdf(pdfBuffer);
    const texto = data.text;
    
    console.log('[extraerDatosPagare] Texto extraído del PDF (primeros 500 chars):', texto.substring(0, 500));
    
    const datosExtraidos = {};
    
    // Extraer número de pagaré (PAGARE N° o No. en Deceval)
    const numeroPagereMatches = [
      /PAGARE\s+N[°º]\s*([0-9]+)/i,
      /identificado en Deceval con No\.\s*([0-9]+)/i,
      /Certificado No\.([0-9]+)/i
    ];
    
    for (const regex of numeroPagereMatches) {
      try {
        const match = texto.match(regex);
        if (match && match[1]) {
          datosExtraidos.numeroPagare = match[1];
          console.log('[extraerDatosPagare] Número de pagaré encontrado:', datosExtraidos.numeroPagare);
          break;
        }
      } catch (error) {
        console.error('[extraerDatosPagare] Error en regex de número de pagaré:', error);
      }
    }
    
    // Extraer valor/monto con búsqueda inteligente por contexto - MEJORADO
    try {
      console.log('[extraerDatosPagare] Iniciando búsqueda inteligente de valores...');
      
      // ESTRATEGIA 1: Buscar valores cerca de palabras clave específicas
      const patronesCapital = [
        // Patrones para "Capital" o "Monto del pagaré"
        /(?:capital|monto\s*(?:del\s*)?pagaré|valor\s*(?:del\s*)?pagaré)[\s\S]{0,100}?([0-9,]+\.[0-9]{2})/gi,
        /(?:capital|monto)[\s:]*\$?\s*([0-9,]+\.[0-9]{2})/gi,
        // Patrones para secciones específicas del pagaré
        /(?:primer[oa]?|primero)[\s\S]{0,200}?([0-9,]+\.[0-9]{2})/gi,
        /(?:obligación\s*de\s*pago|valor\s*principal)[\s\S]{0,100}?([0-9,]+\.[0-9]{2})/gi,
        // Patrón para valores en tablas o secciones estructuradas
        /(?:valor\s*en\s*números|valor\s*numérico)[\s\S]{0,100}?([0-9,]+\.[0-9]{2})/gi
      ];
      
      let valorEncontradoPorContexto = null;
      
      for (const patron of patronesCapital) {
        const matches = [...texto.matchAll(patron)];
        for (const match of matches) {
          if (match[1]) {
            const valorLimpio = match[1].replace(/,/g, '');
            const valorNumerico = parseFloat(valorLimpio);
            if (!isNaN(valorNumerico) && valorNumerico > 1000) {
              valorEncontradoPorContexto = valorNumerico;
              console.log(`[extraerDatosPagare] Valor encontrado por contexto: ${valorNumerico} (patrón específico)`);
              break;
            }
          }
        }
        if (valorEncontradoPorContexto) break;
      }
      
      // ESTRATEGIA 2: Si no encontró por contexto, buscar en ubicaciones específicas del texto
      if (!valorEncontradoPorContexto) {
        console.log('[extraerDatosPagare] No encontrado por contexto, buscando por ubicación...');
        
        // Buscar todos los valores decimales
        const todosLosValores = [...texto.matchAll(/([0-9,]+\.[0-9]{2})/g)];
        console.log('[extraerDatosPagare] Todos los valores decimales encontrados:', todosLosValores.map(v => v[1]));
        
        // Filtrar valores que NO están en contextos excluidos
        const valoresFiltrados = [];
        
        for (const match of todosLosValores) {
          const valor = match[1];
          const indiceEnTexto = match.index;
          
          // Obtener contexto alrededor del valor (100 caracteres antes y después)
          const contextoAntes = texto.substring(Math.max(0, indiceEnTexto - 100), indiceEnTexto);
          const contextoDespues = texto.substring(indiceEnTexto, indiceEnTexto + 100);
          const contextoCompleto = (contextoAntes + contextoDespues).toLowerCase();
          
          // Excluir valores que aparezcan en contextos de intereses, comisiones, etc.
          const esExcluido = contextoCompleto.includes('interés') ||
                           contextoCompleto.includes('intereses') ||
                           contextoCompleto.includes('comisión') ||
                           contextoCompleto.includes('comisiones') ||
                           contextoCompleto.includes('mora') ||
                           contextoCompleto.includes('multa') ||
                           contextoCompleto.includes('gastos') ||
                           contextoCompleto.includes('administración') ||
                           contextoCompleto.includes('expedición') ||
                           contextoCompleto.includes('certificación');
          
          if (!esExcluido) {
            const valorNumerico = parseFloat(valor.replace(/,/g, ''));
            if (!isNaN(valorNumerico) && valorNumerico > 1000) {
              valoresFiltrados.push({
                valor: valorNumerico,
                indice: indiceEnTexto,
                contexto: contextoCompleto.substring(0, 50)
              });
            }
          }
        }
        
        console.log('[extraerDatosPagare] Valores filtrados (sin contextos excluidos):', valoresFiltrados.length);
        
        // ESTRATEGIA 3: Priorizar valores que aparezcan en la primera mitad del documento
        // (donde típicamente está el capital principal)
        if (valoresFiltrados.length > 0) {
          const longitudTexto = texto.length;
          const valoresOrdenados = valoresFiltrados.sort((a, b) => {
            // Priorizar valores en la primera mitad del documento
            const pesoUbicacionA = a.indice < (longitudTexto / 2) ? 1 : 0.5;
            const pesoUbicacionB = b.indice < (longitudTexto / 2) ? 1 : 0.5;
            
            // Priorizar valores más grandes (más probable que sea el capital principal)
            const pesoValorA = a.valor > 10000 ? 1 : 0.8;
            const pesoValorB = b.valor > 10000 ? 1 : 0.8;
            
            const puntajeA = pesoUbicacionA * pesoValorA;
            const puntajeB = pesoUbicacionB * pesoValorB;
            
            return puntajeB - puntajeA; // Orden descendente
          });
          
          valorEncontradoPorContexto = valoresOrdenados[0].valor;
          console.log(`[extraerDatosPagare] Valor seleccionado por heurística: ${valorEncontradoPorContexto} (índice: ${valoresOrdenados[0].indice})`);
        }
      }
      
      // ESTRATEGIA 4: Fallback final - buscar el mayor valor razonable
      if (!valorEncontradoPorContexto) {
        console.log('[extraerDatosPagare] Usando fallback final...');
        const todosLosValores = [...texto.matchAll(/([0-9,]+\.[0-9]{2})/g)];
        const valoresNumericos = todosLosValores
          .map(match => parseFloat(match[1].replace(/,/g, '')))
          .filter(val => !isNaN(val) && val > 1000 && val < 100000000) // Rango razonable
          .sort((a, b) => b - a); // Mayor a menor
        
        if (valoresNumericos.length > 0) {
          valorEncontradoPorContexto = valoresNumericos[0];
          console.log(`[extraerDatosPagare] Valor por fallback (mayor razonable): ${valorEncontradoPorContexto}`);
        }
      }
      
      // Asignar el valor encontrado
      if (valorEncontradoPorContexto) {
        datosExtraidos.valor = valorEncontradoPorContexto;
        datosExtraidos.valorFormateado = formatearValorCompleto(valorEncontradoPorContexto);
        console.log('[extraerDatosPagare] VALOR FINAL:', datosExtraidos.valor, '- Formateado:', datosExtraidos.valorFormateado);
      } else {
        console.warn('[extraerDatosPagare] No se pudo extraer valor del pagaré');
      }
      
    } catch (error) {
      console.error('[extraerDatosPagare] Error en extracción de valores:', error);
    }
    
    // Extraer fechas específicas del pagaré - MEJORADO
    // Buscar fecha de suscripción con múltiples patrones más específicos
    let fechaSuscripcionMatch = null;
    
    // Patrón 1: Cerca de "Fecha de suscripción" con flexibilidad en espacios y texto
    const patronesSuscripcion = [
      /(?:Fecha\s*de\s*suscripción|suscripción)[\s:]*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i,
      /suscripción[\s\S]{0,50}([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i,
      /(?:firmad[oa]|suscrit[oa])[\s\S]{0,30}([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i,
      /(?:otorgad[oa]|celebrad[oa])[\s\S]{0,30}([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i
    ];
    
    for (const patron of patronesSuscripcion) {
      fechaSuscripcionMatch = texto.match(patron);
      if (fechaSuscripcionMatch) {
        console.log('[extraerDatosPagare] Fecha suscripción encontrada con patrón específico:', fechaSuscripcionMatch[1]);
        break;
      }
    }
    
    // Fallback: buscar fechas con formato DD-MM-YYYY (menos común pero posible)
    if (!fechaSuscripcionMatch) {
      fechaSuscripcionMatch = texto.match(/([0-9]{2}-[0-9]{2}-[0-9]{4})/);
      if (fechaSuscripcionMatch) {
        console.log('[extraerDatosPagare] Fecha suscripción encontrada en formato DD-MM-YYYY:', fechaSuscripcionMatch[1]);
      }
    }
    
    if (fechaSuscripcionMatch) {
      let fecha = fechaSuscripcionMatch[1];
      try {
        // Convertir formato DD-MM-YYYY a DD/MM/YYYY si es necesario
        if (fecha.includes('-')) {
          const partes = fecha.split('-');
          fecha = `${partes[0]}/${partes[1]}/${partes[2]}`;
        }
        datosExtraidos.fechaSuscripcion = fecha;
        console.log('[extraerDatosPagare] Fecha suscripción procesada:', datosExtraidos.fechaSuscripcion);
      } catch (error) {
        console.error('[extraerDatosPagare] Error procesando fecha de suscripción:', error);
      }
    }
    
    // Buscar fecha de vencimiento cerca de "Fecha de vencimiento"
    let fechaVencimientoMatch = texto.match(/(?:Fecha de vencimiento|vencimiento)\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i);
    if (!fechaVencimientoMatch) {
      fechaVencimientoMatch = texto.match(/(30\/08\/2026)/);
    }
    if (!fechaVencimientoMatch) {
      fechaVencimientoMatch = texto.match(/(2026-08-30)/);
    }
    
    if (fechaVencimientoMatch) {
      let fecha = fechaVencimientoMatch[1] || '30/08/2026';
      try {
        // Convertir formato si es necesario
        if (fecha.includes('-')) {
          const partes = fecha.split('-');
          fecha = `${partes[2]}/${partes[1]}/${partes[0]}`;
        }
        datosExtraidos.fechaVencimiento = fecha;
        datosExtraidos.fechaMora = calcularFechaMora(fecha);
        console.log('[extraerDatosPagare] Fecha vencimiento encontrada:', datosExtraidos.fechaVencimiento);
        console.log('[extraerDatosPagare] Fecha mora calculada:', datosExtraidos.fechaMora);
      } catch (error) {
        console.error('[extraerDatosPagare] Error procesando fecha de vencimiento:', error);
      }
    }
    
    // Si no encontramos las fechas específicas, buscar con lógica inteligente mejorada
    if (!datosExtraidos.fechaSuscripcion || !datosExtraidos.fechaVencimiento) {
      const todasLasFechas = [...texto.matchAll(/([0-9]{2}\/[0-9]{2}\/[0-9]{4})/g)];
      console.log('[extraerDatosPagare] Todas las fechas encontradas:', todasLasFechas.map(f => f[1]));
      
      // Filtrar fechas relevantes con rango más amplio y excluir fechas de expedición/certificación
      const fechasRelevantes = todasLasFechas.filter(f => {
        const año = parseInt(f[1].split('/')[2]);
        const fecha = f[1];
        
        // Excluir fechas que probablemente son de expedición/certificación (2023-2024)
        // y fechas muy futuras o pasadas
        return año >= 2020 && año <= 2030 && año !== 2023 && año !== 2024;
      });
      
      console.log('[extraerDatosPagare] Fechas relevantes filtradas:', fechasRelevantes.map(f => f[1]));
      
      // NUEVA LÓGICA: Buscar fecha de suscripción por contexto en el texto
      if (!datosExtraidos.fechaSuscripcion && fechasRelevantes.length > 0) {
        // Buscar fechas que aparezcan después de palabras clave relacionadas con suscripción
        const contextoBuscado = ['suscripción', 'firmado', 'otorgado', 'celebrado', 'firmada'];
        let fechaSuscripcionEncontrada = null;
        
        for (const contextWord of contextoBuscado) {
          const indicePalabra = texto.toLowerCase().indexOf(contextWord);
          if (indicePalabra !== -1) {
            // Buscar la fecha más cercana después de esta palabra
            const textoDesPuesContexto = texto.substring(indicePalabra);
            const fechaMatch = textoDesPuesContexto.match(/([0-9]{2}\/[0-9]{2}\/[0-9]{4})/);
            if (fechaMatch) {
              const fechaEncontrada = fechaMatch[1];
              const añoEncontrado = parseInt(fechaEncontrada.split('/')[2]);
              // Verificar que sea una fecha razonable para suscripción
              if (añoEncontrado >= 2020 && añoEncontrado <= 2030 && añoEncontrado !== 2023 && añoEncontrado !== 2024) {
                fechaSuscripcionEncontrada = fechaEncontrada;
                console.log(`[extraerDatosPagare] Fecha suscripción encontrada por contexto "${contextWord}":`, fechaSuscripcionEncontrada);
                break;
              }
            }
          }
        }
        
        if (fechaSuscripcionEncontrada) {
          datosExtraidos.fechaSuscripcion = fechaSuscripcionEncontrada;
        } else if (fechasRelevantes.length > 0) {
          // Solo como último recurso, tomar la fecha más antigua de las relevantes
          const fechasOrdenadas = fechasRelevantes.map(f => {
            const partes = f[1].split('/');
            return {
              fecha: f[1],
              timestamp: new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0])).getTime()
            };
          }).sort((a, b) => a.timestamp - b.timestamp);
          
          datosExtraidos.fechaSuscripcion = fechasOrdenadas[0].fecha;
          console.log('[extraerDatosPagare] Fecha suscripción por fallback (más antigua):', datosExtraidos.fechaSuscripcion);
        }
      }
      
      // Buscar fecha de vencimiento (la fecha más futura entre las relevantes)
      if (!datosExtraidos.fechaVencimiento && fechasRelevantes.length > 0) {
        const fechasOrdenadas = fechasRelevantes.map(f => {
          const partes = f[1].split('/');
          return {
            fecha: f[1],
            timestamp: new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0])).getTime()
          };
        }).sort((a, b) => b.timestamp - a.timestamp);
        
        datosExtraidos.fechaVencimiento = fechasOrdenadas[0].fecha;
        datosExtraidos.fechaMora = calcularFechaMora(datosExtraidos.fechaVencimiento);
        console.log('[extraerDatosPagare] Fecha vencimiento encontrada (más futura):', datosExtraidos.fechaVencimiento);
        console.log('[extraerDatosPagare] Fecha mora calculada:', datosExtraidos.fechaMora);
      }
    }
    
    // Extraer información del deudor y codeudor (OTORGANTES)
    // Buscar múltiples patrones de deudores
    const patronesDeudor = [
      /(?:OTORGANTE[S]?|CODEUDOR)\s*([A-Z\s]+)\s*\/\s*CC\s*([0-9]+)/gi,
      /([A-Z\s]+)\s*\/\s*CC\s*([0-9]+)/gi,
      /([A-Z\s]+)\s*con\s*C\.C\.\s*([0-9]+)/gi,
      /([A-Z\s]+)\s*identificad[ao]\s*con\s*C\.C\.\s*No\.\s*([0-9]+)/gi
    ];
    
    let deudoresEncontrados = [];
    
    for (const patron of patronesDeudor) {
      const matches = [...texto.matchAll(patron)];
      for (const match of matches) {
        if (match[1] && match[2]) {
          let nombre = match[1].trim();
          const cedula = match[2];
          
          // Limpiar el nombre eliminando palabras de rol
          nombre = nombre.replace(/^(OTORGANTE[S]?|CODEUDOR)\s*/gi, '').trim();
          
          // Filtrar nombres que sean demasiado cortos o que contengan palabras no relevantes
          if (nombre.length > 5 && 
              !nombre.includes('COOPERATIVA') && 
              !nombre.includes('SURAMERICANA') &&
              !nombre.includes('FILIALES') &&
              !nombre.includes('COOPEMSURA') &&
              !deudoresEncontrados.some(d => d.cedula === cedula)) {
            
            deudoresEncontrados.push({
              nombre: nombre,
              cedula: cedula,
              completo: formatearNombreConCC(nombre, cedula)
            });
          }
        }
      }
    }
    
    // Asignar deudores encontrados
    if (deudoresEncontrados.length > 0) {
      datosExtraidos.nombreDeudor = deudoresEncontrados[0].nombre;
      datosExtraidos.cedulaDeudor = deudoresEncontrados[0].cedula;
      datosExtraidos.deudorCompleto = deudoresEncontrados[0].completo;
      console.log('[extraerDatosPagare] Deudor principal encontrado:', datosExtraidos.deudorCompleto);
      
      // Si hay un segundo deudor (codeudor)
      if (deudoresEncontrados.length > 1) {
        datosExtraidos.nombreCodeudor = deudoresEncontrados[1].nombre;
        datosExtraidos.cedulaCodeudor = deudoresEncontrados[1].cedula;
        datosExtraidos.codeudorCompleto = deudoresEncontrados[1].completo;
        console.log('[extraerDatosPagare] Codeudor encontrado:', datosExtraidos.codeudorCompleto);
      }
      
      console.log('[extraerDatosPagare] Total deudores encontrados en PDF:', deudoresEncontrados.length);
    }
    
    // Extraer beneficiario (COOPERATIVA)
    let beneficiarioMatch = texto.match(/COOPERATIVA DE EMPLEADOS DE SURAMERICANA Y FILIALES[^N]*NIT\s*([0-9]+)/i);
    if (!beneficiarioMatch) {
      beneficiarioMatch = texto.match(/COOPERATIVA DE EMPLEADOS DE SURAMERICANA Y FILIALES[^0-9]*([0-9]+)/i);
    }
    if (!beneficiarioMatch) {
      // Buscar NIT específico de COOPEMSURA
      beneficiarioMatch = texto.match(/(800117821[0-9])/);
      if (beneficiarioMatch) {
        beneficiarioMatch = [beneficiarioMatch[0], beneficiarioMatch[1]];
      }
    }
    
    if (beneficiarioMatch) {
      try {
        datosExtraidos.beneficiario = 'COOPERATIVA DE EMPLEADOS DE SURAMERICANA Y FILIALES-COOPEMSURA';
        datosExtraidos.nitBeneficiario = beneficiarioMatch[1];
        console.log('[extraerDatosPagare] Beneficiario encontrado:', datosExtraidos.beneficiario);
      } catch (error) {
        console.error('[extraerDatosPagare] Error procesando datos del beneficiario:', error);
      }
    }
    
    console.log('[extraerDatosPagare] Datos extraídos del pagaré:', datosExtraidos);
    return datosExtraidos;
    
  } catch (error) {
    console.error('[extraerDatosPagare] Error al extraer datos del pagaré:', error);
    return {};
  }
}

// === FUNCIONES AUXILIARES PARA DETECCIÓN DE PAGARÉS ===

// Función MEJORADA para detectar cuántos pagarés hay en un proceso
function detectarCantidadPagares(process) {
  console.log('[detectarCantidadPagares] Analizando proceso:', process.proceso_id);
  console.log('[detectarCantidadPagares] Estructura completa del proceso:', {
    documentos: process.documentos ? Object.keys(process.documentos) : 'NO HAY',
    campos_pagare: {
      numero_pagare: process.numero_pagare,
      numero_pagare_2: process.numero_pagare_2,
      numero_pagare_3: process.numero_pagare_3,
      pagares_array: process.pagares
    },
    valores: {
      valor: process.valor,
      valor_2: process.valor_2,
      valor_3: process.valor_3
    }
  });
  
  let cantidadPagares = 1; // Por defecto asumimos 1 pagaré
  
  try {
    // Estrategia 1: Revisar si hay múltiples documentos de pagaré (MEJORADA)
    if (process.documentos) {
      console.log('[detectarCantidadPagares] Revisando documentos:', Object.keys(process.documentos));
      
      // Buscar pagarés numerados con diferentes patrones
      const documentKeys = Object.keys(process.documentos);
      const pagareKeys = documentKeys.filter(key => {
        const keyLower = key.toLowerCase();
        return keyLower.includes('pagare') || keyLower.includes('pagaré');
      });
      
      console.log('[detectarCantidadPagares] Documentos de pagaré encontrados:', pagareKeys);
      
      if (pagareKeys.length > 1) {
        cantidadPagares = pagareKeys.length;
        console.log('[detectarCantidadPagares] ✅ Múltiples documentos de pagaré detectados:', cantidadPagares);
        return cantidadPagares; // Retornar temprano si encontramos documentos múltiples
      }
    }
    
    // Estrategia 2: Revisar si hay múltiples números de pagaré en los datos (MEJORADA)
    if (cantidadPagares === 1) {
      const pagareNumbers = [];
      
      // Buscar números de pagaré en diferentes campos posibles con validación
      if (process.numero_pagare && process.numero_pagare.toString().trim()) {
        pagareNumbers.push(process.numero_pagare);
      }
      if (process.numero_pagare_2 && process.numero_pagare_2.toString().trim()) {
        pagareNumbers.push(process.numero_pagare_2);
      }
      if (process.numero_pagare_3 && process.numero_pagare_3.toString().trim()) {
        pagareNumbers.push(process.numero_pagare_3);
      }
      
      console.log('[detectarCantidadPagares] Números de pagaré encontrados:', pagareNumbers);
      
      // Buscar en array de pagarés si existe
      if (process.pagares && Array.isArray(process.pagares) && process.pagares.length > 0) {
        cantidadPagares = process.pagares.length;
        console.log('[detectarCantidadPagares] ✅ Array de pagarés encontrado:', cantidadPagares);
        return cantidadPagares;
      } else if (pagareNumbers.length > 1) {
        // Verificar que sean números diferentes (no duplicados)
        const numerosUnicos = [...new Set(pagareNumbers.map(n => n.toString().trim()))];
        if (numerosUnicos.length > 1) {
          cantidadPagares = numerosUnicos.length;
          console.log('[detectarCantidadPagares] ✅ Múltiples números únicos de pagaré:', cantidadPagares, numerosUnicos);
          return cantidadPagares;
        }
      }
    }
    
    // Estrategia 3: Revisar si hay múltiples valores/montos (MEJORADA)
    if (cantidadPagares === 1) {
      const valores = [];
      
      if (process.valor && process.valor.toString().trim() && process.valor.toString().trim() !== '0') {
        valores.push(process.valor);
      }
      if (process.valor_2 && process.valor_2.toString().trim() && process.valor_2.toString().trim() !== '0') {
        valores.push(process.valor_2);
      }
      if (process.valor_3 && process.valor_3.toString().trim() && process.valor_3.toString().trim() !== '0') {
        valores.push(process.valor_3);
      }
      
      console.log('[detectarCantidadPagares] Valores encontrados:', valores);
      
      if (valores.length > 1) {
        // Verificar que sean valores diferentes (no duplicados)
        const valoresUnicos = [...new Set(valores.map(v => v.toString().trim()))];
        if (valoresUnicos.length > 1) {
          cantidadPagares = valoresUnicos.length;
          console.log('[detectarCantidadPagares] ✅ Múltiples valores únicos encontrados:', cantidadPagares, valoresUnicos);
          return cantidadPagares;
        }
      }
    }
    
    // Estrategia 4: NUEVA - Buscar en campos calculados o derivados
    if (cantidadPagares === 1) {
      // Buscar campos que indiquen múltiples pagarés
      const camposMultiples = [];
      
      for (const [key, value] of Object.entries(process)) {
        if (key.includes('_2') || key.includes('_3')) {
          if (value && value.toString().trim() && value.toString().trim() !== '0') {
            camposMultiples.push(key);
          }
        }
      }
      
      if (camposMultiples.length > 0) {
        // Estimar cantidad basada en el número más alto encontrado
        const numeros = camposMultiples.map(campo => {
          const match = campo.match(/_(\d+)$/);
          return match ? parseInt(match[1]) : 1;
        });
        
        if (numeros.length > 0) {
          cantidadPagares = Math.max(...numeros, 1);
          console.log('[detectarCantidadPagares] ✅ Múltiples pagarés detectados por campos numerados:', cantidadPagares, camposMultiples);
        }
      }
    }
    
    // Estrategia 5: NUEVA - Analizar el nombre del cliente para casos especiales
    if (cantidadPagares === 1 && process.cliente?.razon) {
      const clienteName = process.cliente.razon.toLowerCase();
      
      // COOPEMSURA típicamente maneja 2-3 pagarés
      if (clienteName.includes('coopemsura') || clienteName.includes('cooperativa')) {
        console.log('[detectarCantidadPagares] ℹ️  Cliente COOPEMSURA detectado - típicamente 2 pagarés');
        // No cambiar automáticamente, pero loggear para debugging
      }
    }
    
    // Limitar a máximo 3 pagarés (según los formatos disponibles)
    if (cantidadPagares > 3) {
      console.warn('[detectarCantidadPagares] Cantidad de pagarés excede máximo esperado, limitando a 3');
      cantidadPagares = 3;
    }
    
    console.log('[detectarCantidadPagares] 🎯 CANTIDAD FINAL DETECTADA:', cantidadPagares);
    return cantidadPagares;
    
  } catch (error) {
    console.error('[detectarCantidadPagares] Error al detectar cantidad de pagarés:', error);
    return 1; // Fallback seguro
  }
}

// Función MEJORADA para buscar plantilla considerando cantidad de pagarés
function buscarPlantillaConPagares(files, clientName, cantidadPagares) {
  console.log('[buscarPlantillaConPagares] 🔍 Buscando plantilla para cliente:', clientName, 'con pagarés:', cantidadPagares);
  console.log('[buscarPlantillaConPagares] Archivos disponibles:', files);
  
  const normalizedClientName = clientName.toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
  
  console.log('[buscarPlantillaConPagares] Cliente normalizado:', normalizedClientName);
  
  let templateFile = null;
  
  // Estrategia 1: Buscar plantilla específica para la cantidad de pagarés (MEJORADA)
  if (cantidadPagares >= 2) {
    console.log(`[buscarPlantillaConPagares] 🎯 Buscando plantilla para ${cantidadPagares} pagarés...`);
    
    // Patrones más específicos y flexibles
    const patronesMultiples = [
      `${cantidadPagares}pagares`,
      `${cantidadPagares} pagares`,
      `${cantidadPagares}_pagares`,
      'multipagares',
      'multipages'
    ];
    
    // Agregar patrones especiales para COOPEMSURA
    if (normalizedClientName.includes('coopemsura') || normalizedClientName.includes('cooperativa')) {
      patronesMultiples.push('2y3pagares', '2 y 3 pagares', '2y3', '2-3');
    }
    
    console.log('[buscarPlantillaConPagares] Patrones a buscar:', patronesMultiples);
    
    for (const patron of patronesMultiples) {
      templateFile = files.find(file => {
        const normalizedFileName = file.toLowerCase()
          .replace(/\./g, '')
          .replace(/\s+/g, '')
          .replace(/[^a-z0-9]/g, '');
        
        const tieneCliente = normalizedFileName.includes(normalizedClientName);
        const tienePatron = normalizedFileName.includes(patron.replace(/[\s_-]/g, ''));
        
        console.log(`[buscarPlantillaConPagares] 📄 "${file}" - Cliente: ${tieneCliente}, Patrón "${patron}": ${tienePatron}`);
        
        const esDocx = file.endsWith('.docx') && !file.startsWith('~$');
        
        return tieneCliente && tienePatron && esDocx;
      });
      
      if (templateFile) {
        console.log(`[buscarPlantillaConPagares] ✅ Plantilla encontrada para ${cantidadPagares} pagarés:`, templateFile);
        return templateFile; // Retornar inmediatamente si encontramos una específica
      }
    }
    
    console.log(`[buscarPlantillaConPagares] ❌ No se encontró plantilla específica para ${cantidadPagares} pagarés`);
  }
  
  // Estrategia 2: Si no encontró para múltiples pagarés, buscar plantilla estándar (MEJORADA)
  if (!templateFile) {
    console.log('[buscarPlantillaConPagares] 🔍 Buscando plantilla estándar...');
    
    templateFile = files.find(file => {
      const normalizedFileName = file.toLowerCase()
        .replace(/\./g, '')
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/g, '');
      
      const tieneCliente = normalizedFileName.includes(normalizedClientName);
      
      // Es estándar si NO contiene indicadores de múltiples pagarés
      const esEstandar = !normalizedFileName.includes('2pagares') && 
                        !normalizedFileName.includes('3pagares') && 
                        !normalizedFileName.includes('2y3pagares') &&
                        !normalizedFileName.includes('multipagares') &&
                        !normalizedFileName.includes('2y3') &&
                        !normalizedFileName.includes('multi');
      
      const esDocx = file.endsWith('.docx') && !file.startsWith('~$');
      
      console.log(`[buscarPlantillaConPagares] 📄 "${file}" - Cliente: ${tieneCliente}, Estándar: ${esEstandar}, DOCX: ${esDocx}`);
      
      return tieneCliente && esEstandar && esDocx;
    });
    
    if (templateFile) {
      console.log(`[buscarPlantillaConPagares] ✅ Plantilla estándar encontrada:`, templateFile);
    }
  }
  
  // Estrategia 3: Buscar por palabras clave (fallback MEJORADO)
  if (!templateFile && clientName) {
    console.log('[buscarPlantillaConPagares] 🔍 Buscando por palabras clave...');
    
    const keywords = clientName.toLowerCase().split(/\s+/).filter(k => k.length > 2);
    console.log('[buscarPlantillaConPagares] Keywords extraídas:', keywords);
    
    // Primero intentar con plantilla específica para múltiples pagarés
    if (cantidadPagares >= 2) {
      templateFile = files.find(file => {
        const lowerFile = file.toLowerCase();
        const tieneKeyword = keywords.some(keyword => 
          lowerFile.includes(keyword.toLowerCase())
        );
        const esMultiple = lowerFile.includes('2 pagares') || 
                          lowerFile.includes('3 pagares') || 
                          lowerFile.includes('2 y 3 pagares') ||
                          lowerFile.includes('multipagares');
        
        const esDocx = file.endsWith('.docx') && !file.startsWith('~$');
        
        console.log(`[buscarPlantillaConPagares] 📄 Keywords "${file}" - Keyword: ${tieneKeyword}, Múltiple: ${esMultiple}, DOCX: ${esDocx}`);
        
        return tieneKeyword && esMultiple && esDocx;
      });
    }
    
    // Si no encontró múltiples, buscar estándar por keywords
    if (!templateFile) {
      templateFile = files.find(file => {
        const lowerFile = file.toLowerCase();
        const tieneKeyword = keywords.some(keyword => 
          lowerFile.includes(keyword.toLowerCase())
        );
        const esEstandar = !lowerFile.includes('2 pagares') && 
                          !lowerFile.includes('3 pagares') && 
                          !lowerFile.includes('2 y 3 pagares') &&
                          !lowerFile.includes('multipagares');
        
        const esDocx = file.endsWith('.docx') && !file.startsWith('~$');
        
        console.log(`[buscarPlantillaConPagares] 📄 Keywords estándar "${file}" - Keyword: ${tieneKeyword}, Estándar: ${esEstandar}, DOCX: ${esDocx}`);
        
        return tieneKeyword && esEstandar && esDocx;
      });
    }
    
    if (templateFile) {
      console.log(`[buscarPlantillaConPagares] ✅ Plantilla por keywords encontrada:`, templateFile);
    }
  }
  
  // Estrategia 4: NUEVA - Fallback ultra flexible
  if (!templateFile) {
    console.log('[buscarPlantillaConPagares] 🆘 Fallback: buscando cualquier plantilla que coincida...');
    
    // Buscar cualquier archivo que contenga parte del nombre del cliente
    templateFile = files.find(file => {
      if (!file.endsWith('.docx') || file.startsWith('~$')) return false;
      
      const lowerFile = file.toLowerCase();
      const lowerClient = clientName.toLowerCase();
      
      // Buscar coincidencias parciales
      const palabrasCliente = lowerClient.split(/\s+/);
      const tieneCoincidencia = palabrasCliente.some(palabra => 
        palabra.length > 3 && lowerFile.includes(palabra)
      );
      
      console.log(`[buscarPlantillaConPagares] 📄 Fallback "${file}" - Coincidencia: ${tieneCoincidencia}`);
      
      return tieneCoincidencia;
    });
    
    if (templateFile) {
      console.log(`[buscarPlantillaConPagares] ✅ Plantilla por fallback encontrada:`, templateFile);
    }
  }
  
  console.log(`[buscarPlantillaConPagares] 🎯 RESULTADO FINAL:`, templateFile || 'NO ENCONTRADA');
  return templateFile;
}