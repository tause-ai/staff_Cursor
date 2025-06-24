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

// Obtener los campos de una plantilla Word
ipcMain.handle('app:getTemplateFields', async (event, clientName) => {
  console.log(`[getTemplateFields] Buscando plantilla para cliente: "${clientName}"`);
  try {
    if (!clientName) {
      console.warn('[getTemplateFields] Se recibió un nombre de cliente vacío.');
      return [];
    }
    // Normalizamos el nombre para la búsqueda (ej: "Coopemsura" -> "coopemsura")
    const normalizedClientName = clientName.toLowerCase().replace(/\./g, '').split(' ')[0];
    console.log(`[getTemplateFields] Nombre normalizado para búsqueda: "${normalizedClientName}"`);
    
    const templatesDir = path.join(__dirname, 'formatos', 'formatos');
    const files = await fs.readdir(templatesDir);

    // Buscamos un archivo que contenga el nombre normalizado.
    // Esto es básico y podría mejorarse con un mapeo más explícito.
    const templateFile = files.find(file => 
      file.toLowerCase().includes(normalizedClientName) && file.endsWith('.docx')
    );

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

// Mapear los datos de un proceso a los campos de la plantilla
ipcMain.handle('app:getProcessMappedData', async (event, process) => {
  // Log para ver exactamente qué proceso estamos recibiendo
  console.log('[getProcessMappedData] Iniciando mapeo para el proceso:', JSON.stringify(process, null, 2));
  
  try {
    // Hacemos el código robusto: aceptamos 'deudores' (plural) o 'deudor' (singular)
    let deudores = [];
    if (process.deudores && Array.isArray(process.deudores)) {
        deudores = process.deudores;
    } else if (process.deudor) {
        deudores = [process.deudor];
    }

    const cliente = process.cliente || {};
    const deudorPrincipal = deudores.length > 0 ? deudores[0] : {};

    // Mapeo inicial SOLO con los datos directos del proceso
    const mappedData = {
      'JUZGADO': process.juzgado_origen || 'Juzgado Civil Municipal',
      'DOMICILIO': deudorPrincipal.ciudad || '',
      'CUANTIA': 'MÍNIMA',
      'DEMANDADO_1': deudorPrincipal.nombre || '',
      'DEMANDADO_2': deudores.length > 1 ? deudores[1].nombre : '',
      'DIRECCION_NOTIFICACION': deudorPrincipal.direccion || '',
      'CORREO': deudorPrincipal.email || '',
    };
    
    console.log('[getProcessMappedData] Mapeo desde API/JSON completado:', JSON.stringify(mappedData, null, 2));

    // --- La extracción desde PDF queda desactivada por ahora ---
    console.log('[getProcessMappedData] La extracción desde PDF está desactivada para esta prueba.');
    
    return mappedData;

  } catch (error) {
    console.error('Error al mapear los datos del proceso:', error);
    return {};
  }
});

// Diligenciar una demanda con los datos de un proceso
ipcMain.handle('app:diligenciarDemanda', async (event, proceso) => {
  console.log('[diligenciarDemanda] Iniciando diligenciamiento para proceso:', proceso.proceso_id);
  console.log('[diligenciarDemanda] Cliente:', proceso.cliente?.razon);
  
  try {
    // 1. Obtener los datos mapeados del proceso (copiamos la lógica aquí)
    console.log('[diligenciarDemanda] Estructura del proceso recibido:', JSON.stringify(proceso, null, 2));
    
    let deudores = [];
    if (proceso.deudores && Array.isArray(proceso.deudores)) {
        deudores = proceso.deudores;
    } else if (proceso.deudor) {
        deudores = [proceso.deudor];
    }

    const cliente = proceso.cliente || {};
    const deudorPrincipal = deudores.length > 0 ? deudores[0] : {};
    const deudorSecundario = deudores.length > 1 ? deudores[1] : {};

    // Mapeo más completo y robusto de datos
    const mappedData = {
      // Información del juzgado
      'JUZGADO': proceso.juzgado_origen || proceso.juzgado || 'Juzgado Civil Municipal',
      'CIUDAD': proceso.ciudad || deudorPrincipal.ciudad || cliente.ciudad || 'Bogotá D.C.',
      'DOMICILIO': deudorPrincipal.ciudad || proceso.ciudad || 'Bogotá D.C.',
      
      // Información de cuantía
      'CUANTIA': proceso.cuantia || proceso.valor || 'MÍNIMA',
      'VALOR': proceso.valor || proceso.cuantia || '',
      'MONTO': proceso.monto || proceso.valor || proceso.cuantia || '',
      
      // Información del demandante (cliente)
      'DEMANDANTE': cliente.razon || cliente.nombre || '',
      'CLIENTE': cliente.razon || cliente.nombre || '',
      'ENTIDAD': cliente.razon || cliente.nombre || '',
      
      // Información del demandado principal
      'DEMANDADO': deudorPrincipal.nombre || '',
      'DEMANDADO_1': deudorPrincipal.nombre || '',
      'DEUDOR': deudorPrincipal.nombre || '',
      'NOMBRE_DEUDOR': deudorPrincipal.nombre || '',
      'CEDULA_DEUDOR': deudorPrincipal.cedula || deudorPrincipal.documento || '',
      'DIRECCION_DEUDOR': deudorPrincipal.direccion || '',
      'TELEFONO_DEUDOR': deudorPrincipal.telefono || '',
      'EMAIL_DEUDOR': deudorPrincipal.email || '',
      
      // Información del demandado secundario (si existe)
      'DEMANDADO_2': deudorSecundario.nombre || '',
      'DEUDOR_2': deudorSecundario.nombre || '',
      'CEDULA_DEUDOR_2': deudorSecundario.cedula || deudorSecundario.documento || '',
      
      // Información de notificación
      'DIRECCION_NOTIFICACION': deudorPrincipal.direccion || '',
      'CORREO': deudorPrincipal.email || '',
      'CORREO_NOTIFICACION': deudorPrincipal.email || '',
      
      // Información del proceso
      'PROCESO_ID': proceso.proceso_id || '',
      'NUMERO_PROCESO': proceso.numero_proceso || proceso.proceso_id || '',
      'FECHA': new Date().toLocaleDateString('es-CO'),
      'FECHA_ACTUAL': new Date().toLocaleDateString('es-CO'),
      
      // Información adicional
      'ABOGADO': proceso.abogado || '',
      'FIRMA_ABOGADO': proceso.firma_abogado || '',
      'TARJETA_PROFESIONAL': proceso.tarjeta_profesional || ''
    };
    
    // Filtrar campos vacíos para el log
    const nonEmptyFields = Object.fromEntries(
      Object.entries(mappedData).filter(([key, value]) => value && value.toString().trim())
    );
    
    console.log('[diligenciarDemanda] Datos mapeados (campos con valor):', nonEmptyFields);
    
    // 2. Buscar el formato de demanda correspondiente
    const clientName = proceso.cliente?.razon || '';
    console.log('[diligenciarDemanda] Buscando formato para cliente:', clientName);
    
    const templatesDir = path.join(__dirname, 'formatos', 'formatos');
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
    
    // Estrategia 1: Buscar por nombre exacto normalizado
    templateFile = files.find(file => {
      const normalizedFileName = file.toLowerCase()
        .replace(/\./g, '')
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/g, '');
      return normalizedFileName.includes(normalizedClientName) && 
             file.toLowerCase().includes('normal') && 
             file.endsWith('.docx');
    });
    
    // Estrategia 2: Buscar por palabras clave del nombre
    if (!templateFile && clientName) {
      const keywords = clientName.toLowerCase().split(/\s+/);
      templateFile = files.find(file => {
        const lowerFile = file.toLowerCase();
        return keywords.some(keyword => 
          keyword.length > 2 && 
          lowerFile.includes(keyword) && 
          lowerFile.includes('normal') && 
          file.endsWith('.docx')
        );
      });
    }
    
    // Estrategia 3: Usar el primer formato disponible como fallback
    if (!templateFile) {
      templateFile = files.find(file => 
        file.toLowerCase().includes('formato') && 
        file.toLowerCase().includes('normal') && 
        file.endsWith('.docx')
      );
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
    const outputDir = path.join(documentsPath, 'Demandas_Staff2');
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
      
      // Resaltar los campos que fueron reemplazados
      let highlightedHtml = htmlContent;
      Object.keys(mappedData).forEach(key => {
        const value = mappedData[key];
        if (value && value.toString().trim()) {
          // Crear un patrón para resaltar el valor reemplazado
          const regex = new RegExp(`\\b${value.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
          highlightedHtml = highlightedHtml.replace(regex, `<mark class="field-highlight" data-field="${key}" style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 2px; cursor: pointer;" title="Campo: ${key}">${value}</mark>`);
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