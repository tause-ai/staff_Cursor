# Staff2 Vite - Aplicación de Escritorio para Automatización de Demandas Legales

Una aplicación de escritorio construida con Electron, React y Material UI para automatizar el llenado de formatos de demandas legales. La aplicación se conecta a APIs internas de intranet para obtener datos de procesos y generar documentos automáticamente.

## 🚀 Características

- **Interfaz moderna**: UI construida con React y Material UI
- **Modo offline**: Caché local de datos diarios para trabajo sin conexión
- **Procesamiento de documentos**: Extracción de texto de PDFs y llenado de plantillas Word
- **Múltiples pantallas**: Lista de procesos, detalles, editor de demandas, historial local
- **Manejo robusto de errores**: Notificaciones y fallbacks para diferentes escenarios
- **Soporte multi-entidad**: Plantillas para diferentes entidades financieras

## 📋 Requisitos

- Node.js 18+ 
- npm o yarn
- Conexión a intranet (para datos en vivo)

## 🛠️ Instalación

1. Clona el repositorio:
```bash
git clone https://github.com/tause-ai/staff_Cursor.git
cd staff_Cursor
```

2. Instala las dependencias:
```bash
npm install
```

3. Ejecuta en modo desarrollo:
```bash
# Terminal 1: Servidor de desarrollo Vite
npm run dev

# Terminal 2: Aplicación Electron
npm run electron
```

## 📁 Estructura del Proyecto

```
staff2-vite/
├── src/
│   ├── App.jsx          # Componente principal de React
│   ├── main.jsx         # Punto de entrada de React
│   └── preload.js       # Script de preload para Electron
├── electron.cjs         # Proceso principal de Electron
├── formatos/            # Plantillas Word y PDF (excluidas del repo)
├── package.json         # Dependencias y scripts
└── vite.config.js       # Configuración de Vite
```

## 🔧 Configuración

### APIs
La aplicación se conecta a APIs internas para obtener:
- Lista de IDs de procesos del día
- Datos detallados de cada proceso
- Documentos adjuntos (PDFs, Word)

### Plantillas
Los archivos de plantillas (Word/PDF) deben colocarse en la carpeta `formatos/`:
- `formatos/formatos/` - Plantillas de demandas por entidad
- `formatos/Portadas/` - Plantillas de portadas por entidad

## 🎯 Uso

1. **Lista de Procesos**: Vista principal con todos los procesos del día
2. **Detalles del Proceso**: Información completa con pestañas para datos, portada y documentos
3. **Editor de Demanda**: Revisión y edición de datos extraídos
4. **Historial Local**: Procesos procesados anteriormente
5. **Configuración**: Prueba de conectividad con APIs

## 🔄 Flujo de Trabajo

1. La app obtiene IDs de procesos desde la API
2. Para cada ID, obtiene datos detallados y los enriquece
3. Los datos se cachean localmente para uso offline
4. El usuario selecciona un proceso para procesar
5. Se extraen datos clave de documentos adjuntos
6. Se llenan plantillas Word con los datos extraídos
7. Se generan documentos finales listos para uso

## 🛡️ Modo Offline

La aplicación funciona sin conexión usando datos cacheados:
- Los datos se actualizan automáticamente al iniciar
- Si la API no está disponible, usa datos del caché
- El caché se guarda en `~/Library/Application Support/Electron/`

## 📦 Scripts Disponibles

- `npm run dev` - Inicia servidor de desarrollo Vite
- `npm run electron` - Ejecuta aplicación Electron
- `npm run build` - Construye para producción
- `npm run preview` - Previsualiza build de producción

## 🔍 Depuración

La aplicación incluye logs detallados:
- Logs de React en la consola del navegador
- Logs de Electron en la terminal
- Contador visual de procesos en la UI

## 📝 Notas

- Los archivos de plantillas (Word/PDF) son grandes y están excluidos del repositorio
- La aplicación requiere acceso a APIs internas de la intranet
- El caché local se actualiza diariamente

## 🤝 Contribución

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto es privado y confidencial.
