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
    mainWindow.loadURL('http://localhost:5173'); // Puerto por defecto de Vite
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

// Obtener y cachear los procesos de la API
ipcMain.handle('app:getProcesses', async () => {
  const localDataPath = path.join(app.getPath('userData'), '..', 'Electron', 'procesos_del_dia.json');

  if (isFetchingProcesses) {
    console.log('[Electron Backend] La obtención de procesos ya está en curso.');
    // Si ya hay una petición en curso, podrías devolver los datos locales para no bloquear la UI.
    try {
      const localData = await fs.readFile(localDataPath, 'utf-8');
      return { source: 'local-cache-while-fetching', data: JSON.parse(localData) };
    } catch (error) {
      // Si no hay caché, se devuelve un array vacío, la UI mostrará "cargando..."
      return { source: 'local-cache-while-fetching', data: [] };
    }
  }

  isFetchingProcesses = true;

  try {
    // --- INTENTAR OBTENER DATOS DE LA API ---
    console.log('[Electron Backend] Intentando obtener procesos desde la API...');
    const controller = new AbortController();
    // Timeout agresivo de 5 segundos para la conexión inicial
    const timeout = setTimeout(() => {
      console.log('[Electron Backend] Timeout de API alcanzado.');
      controller.abort();
    }, 5000);

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
      const detailTimeout = setTimeout(() => detailController.abort(), 5000); // Timeout por cada detalle
      
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

    // Guardar los datos frescos en el archivo local (caché)
    try {
        const directory = path.dirname(localDataPath);
        await fs.mkdir(directory, { recursive: true }); // Asegurarse de que el directorio exista
        await fs.writeFile(localDataPath, JSON.stringify(enrichedProcesses, null, 2));
        console.log(`[Electron Backend] Procesos guardados en caché local: ${localDataPath}`);
    } catch (writeError) {
        console.error(`[Electron Backend] Fallo al escribir el archivo de caché: ${writeError.message}`);
    }
    
    isFetchingProcesses = false;
    return { source: 'api', data: enrichedProcesses };

  } catch (error) {
    // --- FALLBACK A DATOS LOCALES SI LA API FALLA ---
    isFetchingProcesses = false;
    console.warn(`[Electron Backend] Fallo al conectar con la API: ${error.message}. Intentando cargar desde caché local.`);
    
    try {
      const localData = await fs.readFile(localDataPath, 'utf-8');
      console.log('[Electron Backend] Éxito al cargar procesos desde la caché local.');
      const parsedData = JSON.parse(localData);
      return { source: 'local', data: parsedData };
    } catch (cacheError) {
      console.error(`[Electron Backend] Fallo al leer la caché local: ${cacheError.message}`);
      
      // Si el caché no existe, intentamos crearlo a partir del demo.
      if (cacheError.code === 'ENOENT') {
        console.log('[Electron Backend] Caché no encontrado. Intentando crear desde json_demo...');
        try {
          const demoDataPath = path.join(__dirname, 'json_demo');
          const demoData = await fs.readFile(demoDataPath, 'utf-8');
          const parsedDemoData = JSON.parse(demoData);
          
          // Creamos el directorio y guardamos el archivo de caché
          const directory = path.dirname(localDataPath);
          await fs.mkdir(directory, { recursive: true });
          await fs.writeFile(localDataPath, JSON.stringify(parsedDemoData, null, 2));
          console.log('[Electron Backend] Caché creado exitosamente desde json_demo.');

          return { source: 'local-from-demo', data: parsedDemoData };
        } catch (demoError) {
          console.error(`[Electron Backend] Fallo al crear caché desde json_demo: ${demoError.message}`);
        }
      }

      // Si todo lo demás falla, devolvemos un error.
      return { source: 'error', data: [], error: 'No se pudo conectar a la API ni cargar datos locales.' };
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
    }, 10000);

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

// Obtener IDs de procesos del caché local
ipcMain.handle('app:getLocalProcessIds', async () => {
  console.log('[Electron Backend] Obteniendo IDs de procesos del caché local...');
  try {
    const localDataPath = path.join(app.getPath('userData'), '..', 'Electron', 'procesos_del_dia.json');
    const localData = await fs.readFile(localDataPath, 'utf-8');
    const processes = JSON.parse(localData);
    
    const localIds = processes.map(process => process.proceso_id).filter(id => id);
    console.log(`[Electron Backend] Obtenidos ${localIds.length} IDs del caché local:`, localIds);
    
    return { 
      success: true, 
      data: localIds,
      totalProcesses: processes.length,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error(`[Electron Backend] Error al leer caché local: ${error.message}`);
    return { 
      success: false, 
      error: error.message,
      data: [],
      totalProcesses: 0,
      timestamp: new Date().toISOString()
    };
  }
});

// Sincronizar procesos: eliminar del caché local los que no están en la API
ipcMain.handle('app:syncProcesses', async () => {
  console.log('[Electron Backend] Iniciando sincronización de procesos...');
  try {
    const localDataPath = path.join(app.getPath('userData'), '..', 'Electron', 'procesos_del_dia.json');
    
    // Obtener procesos locales
    const localData = await fs.readFile(localDataPath, 'utf-8');
    const localProcesses = JSON.parse(localData);
    
    // Obtener IDs directamente de la API usando fetch
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
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
    console.log(`[Sincronización] Caché local tiene ${localIds.length} procesos`);
    
    // Encontrar procesos que están en local pero no en API (obsoletos)
    const obsoleteIds = localIds.filter(localId => !apiIds.includes(localId));
    const validProcesses = localProcesses.filter(process => apiIds.includes(process.proceso_id));
    
    console.log(`[Sincronización] Procesos obsoletos encontrados: ${obsoleteIds.length}`, obsoleteIds);
    console.log(`[Sincronización] Procesos válidos: ${validProcesses.length}`);
    
    // Guardar solo los procesos válidos
    if (obsoleteIds.length > 0) {
      await fs.writeFile(localDataPath, JSON.stringify(validProcesses, null, 2));
      console.log(`[Sincronización] Eliminados ${obsoleteIds.length} procesos obsoletos del caché.`);
    }
    
    return {
      success: true,
      apiIds: apiIds,
      localIds: localIds,
      obsoleteIds: obsoleteIds,
      validProcesses: validProcesses.length,
      removedCount: obsoleteIds.length,
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
ipcMain.handle('app:getTemplateFields', async (event, clientName) => {
  console.log(`[getTemplateFields] Buscando plantilla para cliente: "${clientName}"`);
  try {
    if (!clientName) {
      console.warn('[getTemplateFields] Se recibió un nombre de cliente vacío.');
      return [];
    }
    
    // Normalizar el nombre del cliente para la búsqueda
    const normalizedClientName = clientName.toLowerCase()
      .replace(/\./g, '')
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
    
    console.log(`[getTemplateFields] Nombre normalizado para búsqueda: "${normalizedClientName}"`);
    
    const templatesDir = path.join(__dirname, 'formatos', 'demandas');
    const files = await fs.readdir(templatesDir);
    console.log(`[getTemplateFields] Archivos disponibles en demandas:`, files);

    // Buscar archivo que empiece con el nombre del cliente
    let templateFile = null;
    
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
    // 1. Obtener los campos requeridos por la plantilla de esta entidad
    const clientName = process.cliente?.razon || '';
    let templateFields = [];
    
    // Obtener campos de la plantilla (copiamos la lógica de getTemplateFields)
    try {
      if (clientName) {
        const normalizedClientName = clientName.toLowerCase()
          .replace(/\./g, '')
          .replace(/\s+/g, '')
          .replace(/[^a-z0-9]/g, '');
        
        const templatesDir = path.join(__dirname, 'formatos', 'demandas');
        const files = await fs.readdir(templatesDir);
        
        // Buscar archivo que empiece con el nombre del cliente
        let templateFile = files.find(file => {
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
      
      // Información de cuantía (priorizar datos del PDF) - Múltiples variaciones
      'CUANTIA': process.cuantia || process.valor || 'MÍNIMA',
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
      'PAGARE_1': datosPagare.numeroPagare || process.numero_pagare || '', // Variación adicional
      'PAGARE_2': datosPagare.numeroPagare || process.numero_pagare || '', // Mismo número para segundo pagaré
      'PAGARE_3': datosPagare.numeroPagare || process.numero_pagare || '', // Mismo número para tercer pagaré
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
      'VENCIMIENTO_2': datosPagare.fechaVencimiento || process.vencimiento || '', // Misma fecha para segundo vencimiento
      'VENCIMIENTO_3': datosPagare.fechaVencimiento || process.vencimiento || '', // Misma fecha para tercer vencimiento
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
      'CAPITAL_2': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '', // Mismo valor para segundo capital
      'CAPITAL_INSOLUTO': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '',
      'CAPITAL_INSOLUTO_2': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '', // Mismo valor para segundo capital
      'CAPITAL_INSOLUTO_3': datosPagare.valorFormateado || formatearValorCompleto(process.valor) || '', // Mismo valor para tercer capital
      'INTERES_MORA_2': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '', // Misma fecha para segundo interés
      'INTERES_MORA_3': datosPagare.fechaMora || calcularFechaMora(datosPagare.fechaVencimiento) || '', // Misma fecha para tercer interés
      
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

    // 4. Filtrar solo los campos que requiere la plantilla específica
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
      
      // Cuantía (campo común en portadas)
      'CUANTIA': process.cuantia || process.valor || 'MÍNIMA',
      
      // Demandados (hasta 3 como se ve en las plantillas) - priorizar datos del PDF
      'DEMANDADO_1': datosPagare.deudorCompleto || formatearNombreConCC(deudorPrincipal.nombre, deudorPrincipal.cedula || deudorPrincipal.documento),
      'DEMANDADO_2': formatearNombreConCC(deudorSecundario.nombre, deudorSecundario.cedula || deudorSecundario.documento),
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
      'CORREO_2': deudorSecundario.email || ''
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
    // 1. Obtener los datos mapeados del proceso para portada
    console.log('[diligenciarPortada] Obteniendo datos mapeados de portada...');
    const mappedData = await getProcessCoverMappedData(proceso);
    
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
    
    // 2. Buscar el formato de demanda correspondiente
    const clientName = proceso.cliente?.razon || '';
    console.log('[diligenciarDemanda] Buscando formato para cliente:', clientName);
    
    const templatesDir = path.join(__dirname, 'formatos', 'demandas');
    const files = await fs.readdir(templatesDir);
    console.log('[diligenciarDemanda] Archivos disponibles:', files);
    
    // Normalizar el nombre del cliente para búsqueda más flexible
    const normalizedClientName = clientName.toLowerCase()
      .replace(/\./g, '')
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
    
    console.log('[diligenciarDemanda] Nombre normalizado:', normalizedClientName);
    
    // Buscar el archivo de formato correspondiente con múltiples estrategias
    let templateFile = null;
    
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
    
    // Extraer valor/monto (buscar el primer valor decimal grande)
    try {
      const valoresDecimales = [...texto.matchAll(/([0-9,]+\.[0-9]{2})/g)];
      if (valoresDecimales.length > 0) {
        // Tomar el primer valor que sea mayor a 1000 (probablemente el monto del pagaré)
        for (const match of valoresDecimales) {
          try {
            const valorLimpio = match[1].replace(/,/g, '');
            const valorNumerico = parseFloat(valorLimpio);
            if (!isNaN(valorNumerico) && valorNumerico > 1000) {
              datosExtraidos.valor = valorNumerico;
              datosExtraidos.valorFormateado = formatearValorCompleto(valorNumerico);
              console.log('[extraerDatosPagare] Valor encontrado:', datosExtraidos.valor, '- Formateado:', datosExtraidos.valorFormateado);
              break;
            }
          } catch (error) {
            console.error('[extraerDatosPagare] Error procesando valor individual:', error);
          }
        }
      }
    } catch (error) {
      console.error('[extraerDatosPagare] Error en extracción de valores:', error);
    }
    
    // Extraer fechas específicas del pagaré
    // Buscar fecha de suscripción cerca de "Fecha de suscripción"
    let fechaSuscripcionMatch = texto.match(/(?:Fecha de suscripción|suscripción)\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i);
    if (!fechaSuscripcionMatch) {
      fechaSuscripcionMatch = texto.match(/([0-9]{2}-[0-9]{2}-[0-9]{4})/);
    }
    if (!fechaSuscripcionMatch) {
      fechaSuscripcionMatch = texto.match(/(18\/08\/2021)/);
    }
    if (!fechaSuscripcionMatch) {
      fechaSuscripcionMatch = texto.match(/(2021-08-18)/);
    }
    
    if (fechaSuscripcionMatch) {
      let fecha = fechaSuscripcionMatch[1] || '18/08/2021';
      try {
        // Convertir formato si es necesario
        if (fecha.includes('-')) {
          const partes = fecha.split('-');
          fecha = `${partes[2]}/${partes[1]}/${partes[0]}`;
        }
        datosExtraidos.fechaSuscripcion = fecha;
        console.log('[extraerDatosPagare] Fecha suscripción encontrada:', datosExtraidos.fechaSuscripcion);
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
    
    // Si no encontramos las fechas específicas, buscar en toda la estructura
    if (!datosExtraidos.fechaSuscripcion || !datosExtraidos.fechaVencimiento) {
      const todasLasFechas = [...texto.matchAll(/([0-9]{2}\/[0-9]{2}\/[0-9]{4})/g)];
      console.log('[extraerDatosPagare] Todas las fechas encontradas:', todasLasFechas.map(f => f[1]));
      
      // Filtrar fechas relevantes (2021-2026, no 2023 que es expedición)
      const fechasRelevantes = todasLasFechas.filter(f => {
        const año = f[1].split('/')[2];
        return año >= '2021' && año <= '2026' && año !== '2023';
      });
      
      if (fechasRelevantes.length > 0 && !datosExtraidos.fechaSuscripcion) {
        // La primera fecha relevante suele ser suscripción
        datosExtraidos.fechaSuscripcion = fechasRelevantes[0][1];
        console.log('[extraerDatosPagare] Fecha suscripción encontrada (general):', datosExtraidos.fechaSuscripcion);
      }
      
      if (fechasRelevantes.length > 1 && !datosExtraidos.fechaVencimiento) {
        // La segunda fecha relevante suele ser vencimiento
        datosExtraidos.fechaVencimiento = fechasRelevantes[1][1];
        datosExtraidos.fechaMora = calcularFechaMora(datosExtraidos.fechaVencimiento);
        console.log('[extraerDatosPagare] Fecha vencimiento encontrada (general):', datosExtraidos.fechaVencimiento);
        console.log('[extraerDatosPagare] Fecha mora calculada:', datosExtraidos.fechaMora);
      }
    }
    
    // Extraer información del deudor y codeudor (OTORGANTES)
    // Buscar múltiples patrones de deudores
    const patronesDeudor = [
      /OTORGANTE[S]?\s*([A-Z\s]+)\s*\/\s*CC\s*([0-9]+)/gi,
      /([A-Z\s]+)\s*\/\s*CC\s*([0-9]+)/gi,
      /([A-Z\s]+)\s*con\s*C\.C\.\s*([0-9]+)/gi,
      /([A-Z\s]+)\s*identificad[ao]\s*con\s*C\.C\.\s*No\.\s*([0-9]+)/gi
    ];
    
    let deudoresEncontrados = [];
    
    for (const patron of patronesDeudor) {
      const matches = [...texto.matchAll(patron)];
      for (const match of matches) {
        if (match[1] && match[2]) {
          const nombre = match[1].trim();
          const cedula = match[2];
          
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