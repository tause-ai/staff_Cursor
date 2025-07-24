// preload.js - Script de precarga para comunicación segura
const { contextBridge, ipcRenderer } = require('electron');

// API para el renderer process (React)
const electronAPI = {
  // --- Lógica de Negocio Staff 2 ---
  app: {
    // Obtener la lista de procesos desde el backend
    getProcesses: () => 
      ipcRenderer.invoke('app:getProcesses'),
      
    // Obtener los campos de una plantilla de demanda
    getTemplateFields: (entity) =>
      ipcRenderer.invoke('app:getTemplateFields', entity),
      
    // Obtener los campos de una plantilla de portada
    getCoverTemplateFields: (entity) =>
      ipcRenderer.invoke('app:getCoverTemplateFields', entity),
      
    // Obtener los datos de un proceso ya mapeados desde el backend
    getProcessMappedData: (proceso) =>
      ipcRenderer.invoke('app:getProcessMappedData', proceso),

    // Obtener los datos de un proceso mapeados para portada
    getProcessCoverMappedData: (proceso) =>
      ipcRenderer.invoke('app:getProcessCoverMappedData', proceso),

    // Actualizar los datos mapeados de un proceso
    updateMappedData: (processId, updatedMappedData) =>
      ipcRenderer.invoke('app:updateMappedData', processId, updatedMappedData),

    // Enviar un proceso para ser diligenciado
    diligenciarDemanda: (proceso) =>
      ipcRenderer.invoke('app:diligenciarDemanda', proceso),
      
    // Enviar un proceso para generar portada
    diligenciarPortada: (proceso) =>
      ipcRenderer.invoke('app:diligenciarPortada', proceso),
      
    // Obtener ruta de la carpeta de Documentos del usuario
    getDocumentsPath: () => 
      ipcRenderer.invoke('app:getDocumentsPath'),
      
    // Escuchar un evento del proceso principal
    // El 'callback' será la función que se ejecute en React cuando el evento ocurra
    onReload: (callback) => ipcRenderer.on('reload-processes', callback),
    
    // Dejar de escuchar el evento para evitar memory leaks
    offReload: (callback) => ipcRenderer.removeListener('reload-processes', callback),
    
    // --- Funciones de Sincronización ---
    // Obtener IDs de procesos directamente de la API
    getApiProcessIds: () =>
      ipcRenderer.invoke('app:getApiProcessIds'),
      
    // Obtener IDs de procesos del caché local
    getLocalProcessIds: () =>
      ipcRenderer.invoke('app:getLocalProcessIds'),
      
    // Sincronizar procesos eliminando obsoletos
    syncProcesses: () =>
      ipcRenderer.invoke('app:syncProcesses'),
  },

  // --- Operaciones Genéricas ---
  pdf: {
    base64ToPdf: (base64String, outputPath) => 
      ipcRenderer.invoke('pdf:base64ToPdf', base64String, outputPath),
    
    getFileInfo: (filePath) => 
      ipcRenderer.invoke('pdf:getFileInfo', filePath)
  },

  dialog: {
    saveFile: (defaultName) => 
      ipcRenderer.invoke('dialog:saveFile', defaultName)
  },

  shell: {
    openFile: (filePath) => 
      ipcRenderer.invoke('shell:openFile', filePath),
  },

  // --- Utilidades (ejecutadas en el renderer) ---
  utils: {
    formatFileSize: (bytes) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },
    
    getFileExtension: (filename) => {
      return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2);
    }
  }
};

// Exponer API al contexto del renderer de forma segura
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Manejar errores en el preload para depuración
window.addEventListener('error', (event) => {
  console.error('[Preload Error]', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Preload Rejection]', event.reason);
}); 