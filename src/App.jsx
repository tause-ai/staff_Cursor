import React, { useState, useEffect } from 'react';
import { 
  AppBar, 
  Toolbar, 
  Typography, 
  Drawer, 
  List, 
  ListItem, 
  ListItemText, 
  Box, 
  Button,
  Container,
  Paper,
  Grid,
  Card,
  CardContent,
  CardActions,
  Chip,
  Divider,
  List as MuiList,
  ListItemButton,
  Stack,
  TextField,
  Tabs,
  Tab,
  ListItemIcon,
  Snackbar,
  Alert,
  CircularProgress,
} from '@mui/material';
import ListIcon from '@mui/icons-material/List';
import Description from '@mui/icons-material/Description';
import Edit from '@mui/icons-material/Edit';
import History from '@mui/icons-material/History';
import Download from '@mui/icons-material/Download';
import Save from '@mui/icons-material/Save';
import SettingsIcon from '@mui/icons-material/Settings';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import DescriptionIcon from '@mui/icons-material/Description';
import StarIcon from '@mui/icons-material/Star';
import Refresh from '@mui/icons-material/Refresh';
import Visibility from '@mui/icons-material/Visibility';
import PictureAsPdf from '@mui/icons-material/PictureAsPdf';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import FieldEditor from './components/FieldEditor';

const screens = [
  { key: 'processList', label: 'Lista de procesos', icon: <ListIcon /> },
  { key: 'processDetail', label: 'Detalle de proceso', icon: <Description /> },
  { key: 'demandEditor', label: 'Editor de demanda', icon: <Edit /> },
  { key: 'localHistory', label: 'Historial local', icon: <History /> },
  { key: 'config', label: 'Configuración', icon: <SettingsIcon /> },
];

function App() {
  // Estados principales
  const [screen, setScreen] = useState('processList');
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedProcess, setSelectedProcess] = useState(null);
  const [detailTab, setDetailTab] = useState(0);
  const [templateFields, setTemplateFields] = useState([]);
  const [mappedData, setMappedData] = useState(null);
  const [diligenciando, setDiligenciando] = useState(false);
  const [generandoPortada, setGenerandoPortada] = useState(false);
  const [resultadoFinal, setResultadoFinal] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [apiStatus, setApiStatus] = useState({ processes: null, documents: null });
  const [testingApi, setTestingApi] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  
  // Estados para el editor WYSIWYG
  const [editorContent, setEditorContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  
  // Estados para los datos de portada
  const [coverTemplateFields, setCoverTemplateFields] = useState([]);
  const [coverMappedData, setCoverMappedData] = useState(null);
  
  // Estados para la configuración/sincronización
  const [apiIds, setApiIds] = useState([]);
  const [localIds, setLocalIds] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  
  // Estados para el buscador de procesos
  const [searchTerm, setSearchTerm] = useState('');
  const [processStatus, setProcessStatus] = useState({}); // Para trackear el estado de cada proceso
  
  // Estados para el editor de campos
  const [fieldEditorOpen, setFieldEditorOpen] = useState(false);
  const [currentMappedData, setCurrentMappedData] = useState(null);

  useEffect(() => {
    const loadProcesses = async () => {
      setLoading(true);
      setError(null); // Limpiamos errores anteriores al recargar
      
      try {
        const result = await window.electronAPI.app.getProcesses();
        
        console.log('[React] Resultado completo de getProcesses:', result);
        console.log('[React] Fuente de datos:', result.source);
        console.log('[React] Número de procesos recibidos:', result.data?.length || 0);
        
        if (result.source === 'error') {
          setError(result.error);
          setProcesses([]);
          setSnackbar({ open: true, message: `Error: ${result.error}`, severity: 'error' });
        } else {
          // La clave es acceder a result.data, que es el array
          const processesData = result.data || [];
          // Nos aseguramos de que `processes` sea siempre un array
          const finalProcesses = Array.isArray(processesData) ? processesData : [processesData];
          
          console.log('[React] Procesos finales a establecer:', finalProcesses.length);
          console.log('[React] Primeros 3 procesos:', finalProcesses.slice(0, 3));
          
          setProcesses(finalProcesses);
          
          if (result.source === 'local' || result.source === 'local-from-demo') {
            setSnackbar({ open: true, message: 'Modo Offline: Mostrando datos locales.', severity: 'warning' });
          } else if (result.source === 'api') {
            setSnackbar({ open: true, message: 'Datos actualizados desde la API correctamente.', severity: 'success' });
          }
        }
      } catch (e) {
        // Capturamos cualquier otro error inesperado durante la llamada
        const errorMessage = 'Ocurrió un error inesperado al cargar los procesos.';
        setError(errorMessage);
        setProcesses([]);
        setSnackbar({ open: true, message: errorMessage, severity: 'error' });
        console.error(e); // También lo mostramos en la consola para depuración
      } finally {
        setLoading(false);
      }
    };

    // Cargar estado de procesos completados desde localStorage
    const savedStatus = localStorage.getItem('staffbot-process-status');
    if (savedStatus) {
      try {
        setProcessStatus(JSON.parse(savedStatus));
      } catch (e) {
        console.warn('Error al cargar estado de procesos desde localStorage:', e);
      }
    }

    loadProcesses();
    
    // Configurar listener para recarga
    const handleReload = () => {
      console.log('[React] Evento de recarga recibido desde Electron');
      loadProcesses();
    };
    
    window.electronAPI.app.onReload(handleReload);
    
    // Cleanup
    return () => {
      window.electronAPI.app.offReload(handleReload);
    };
  }, []);

  // Actualizar el contenido del editor cuando cambie el resultado
  useEffect(() => {
    if (resultadoFinal && resultadoFinal.htmlContent) {
      setEditorContent(resultadoFinal.htmlContent);
    }
  }, [resultadoFinal]);

  // Cargar datos de sincronización cuando se accede a configuración (solo una vez)
  useEffect(() => {
    if (screen === 'config' && apiIds.length === 0 && localIds.length === 0 && !syncLoading) {
      loadSyncData();
    }
  }, [screen]);

  const fetchProcessDetails = async (processId) => {
    // Ya no necesitamos esta función, la lógica se mueve al diligenciamiento.
    // Simplemente seleccionamos el proceso de la lista que ya tenemos.
    const process = processes.find(p => p.id === processId);
    setSelectedProcess(process);
    setScreen('processDetail');
  };

  const handleDiligenciar = async () => {
    if (!selectedProcess) return;
    setDiligenciando(true);
    setResultadoFinal(null);
    
    try {
      const resultado = await window.electronAPI.app.diligenciarDemanda(selectedProcess);
      setDiligenciando(false);
      setResultadoFinal(resultado);
      
      // Si el diligenciado fue exitoso, navegar automáticamente al Editor de Demanda
      if (resultado.success) {
        // Guardar los datos mapeados para el editor
        setCurrentMappedData(resultado.data);
        // Marcar proceso como completado
        markProcessAsCompleted(selectedProcess.proceso_id);
        setScreen('demandEditor');
      }
    } catch (error) {
      setDiligenciando(false);
      console.error('Error al diligenciar:', error);
    }
  };

  // Función para manejar la edición de campos
  const handleOpenFieldEditor = () => {
    // Establecer los datos actuales antes de abrir el editor
    setCurrentMappedData(mappedData);
    setFieldEditorOpen(true);
  };

  // Función para guardar los campos editados
  const handleSaveEditedFields = async (editedData) => {
    console.log('[handleSaveEditedFields] Iniciando guardado de campos para proceso:', selectedProcess.proceso_id);
    console.log('[handleSaveEditedFields] Datos a guardar:', editedData);
    
    try {
      // Paso 1: Guardar en backend
      console.log('[handleSaveEditedFields] Llamando updateMappedData...');
      const result = await window.electronAPI.app.updateMappedData(
        selectedProcess.proceso_id, 
        editedData
      );
      
      console.log('[handleSaveEditedFields] Respuesta del backend:', result);
      
      if (result.success) {
        // Paso 2: Actualizar estados locales
        console.log('[handleSaveEditedFields] Actualizando estados locales...');
        setCurrentMappedData(editedData);
        setMappedData(editedData);
        
        setSnackbar({ 
          open: true, 
          message: 'Campos guardados exitosamente ✅', 
          severity: 'success' 
        });
        
        // Paso 3: Regenerar documento (opcional, en segundo plano)
        console.log('[handleSaveEditedFields] Iniciando regeneración del documento...');
        try {
          await handleRegenerateDocument();
          console.log('[handleSaveEditedFields] Documento regenerado exitosamente');
        } catch (regenError) {
          console.error('[handleSaveEditedFields] Error en regeneración (no crítico):', regenError);
          setSnackbar({ 
            open: true, 
            message: 'Campos guardados ✅ pero error al regenerar documento. Usa el botón "Regenerar" manualmente.', 
            severity: 'warning' 
          });
        }
        
      } else {
        console.error('[handleSaveEditedFields] Error del backend:', result);
        setSnackbar({ 
          open: true, 
          message: 'Error al actualizar campos: ' + (result.message || 'Error desconocido'), 
          severity: 'error' 
        });
      }
    } catch (error) {
      console.error('[handleSaveEditedFields] Error en comunicación con backend:', error);
      setSnackbar({ 
        open: true, 
        message: 'Error de comunicación: ' + error.message, 
        severity: 'error' 
      });
    }
  };

  const handleGenerarPortada = async () => {
    if (!selectedProcess) {
      setSnackbar({
        open: true,
        message: 'Por favor selecciona un proceso primero.',
        severity: 'warning'
      });
      return;
    }

    setGenerandoPortada(true);
    
    try {
      console.log('Generando portada para proceso:', selectedProcess.proceso_id);
      const resultado = await window.electronAPI.app.diligenciarPortada(selectedProcess);
      
      if (resultado.success) {
        setSnackbar({
          open: true,
          message: `Portada generada exitosamente: ${resultado.fileName}`,
          severity: 'success'
        });
        
        // Marcar proceso como en progreso si aún no está completado
        const currentStatus = getProcessStatus(selectedProcess.proceso_id);
        if (currentStatus === 'pending') {
          markProcessAsInProgress(selectedProcess.proceso_id);
        }
        
        // Opcionalmente abrir el archivo generado
        if (resultado.filePath) {
          setTimeout(() => {
            window.electronAPI.shell.openFile(resultado.filePath);
          }, 1000);
        }
      } else {
        setSnackbar({
          open: true,
          message: `Error al generar portada: ${resultado.message}`,
          severity: 'error'
        });
      }
    } catch (error) {
      console.error('Error al generar portada:', error);
      setSnackbar({
        open: true,
        message: `Error al generar portada: ${error.message}`,
        severity: 'error'
      });
    } finally {
      setGenerandoPortada(false);
    }
  };



  const handleTestApi = async (type) => {
    setTestingApi(type);
    let url;
    if (type === 'processes') {
      url = 'http://192.168.145.6/api/v1/bots/bot_proceso_ids';
    } else {
      // Usamos un ID de prueba. La API debe manejar un ID inválido sin crashear.
      url = 'http://192.168.145.6/api/v1/bots/bot_documentos/1'; 
    }

    try {
      const response = await fetch(url);
      if (!response.ok && response.status !== 404) { // Un 404 para un doc específico puede ser "ok"
        throw new Error(`Error HTTP: ${response.status}`);
      }
      setApiStatus(prev => ({ ...prev, [type]: 'success' }));
    } catch (err) {
      setApiStatus(prev => ({ ...prev, [type]: 'error' }));
    } finally {
      setTestingApi(null);
    }
  };

  const handleDataChange = (e) => {
    // Actualizamos el estado de los datos mapeados cuando el usuario edita un campo
    setMappedData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleCoverMappedDataChange = (e) => {
    setCoverMappedData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleProcessSelect = async (process) => {
    console.log('[React] Proceso seleccionado:', process);
    setSelectedProcess(process);
    setDetailTab(0);
    setMappedData(null); // Limpiamos los datos anteriores
    setCoverMappedData(null); // Limpiamos los datos de portada anteriores
    setTemplateFields([]); // Limpiamos los campos anteriores
    setCoverTemplateFields([]); // Limpiamos los campos de portada anteriores
    
    // Marcar proceso como en progreso si aún no tiene estado
    const currentStatus = getProcessStatus(process.proceso_id);
    if (currentStatus === 'pending') {
      markProcessAsInProgress(process.proceso_id);
    }
    
    if (process.cliente?.razon) {
      console.log('[React] Cargando datos para cliente:', process.cliente.razon);
      
      // Obtenemos tanto los campos requeridos como los datos ya mapeados para demanda
      const fields = await window.electronAPI.app.getTemplateFields(process.cliente.razon);
      const data = await window.electronAPI.app.getProcessMappedData(process);
      console.log('[React] Campos de DEMANDA obtenidos:', fields);
      console.log('[React] Datos de DEMANDA obtenidos:', data);
      setTemplateFields(fields);
      setMappedData(data);
      setCurrentMappedData(data);
      
      // Obtenemos también los campos y datos para portada
      const coverFields = await window.electronAPI.app.getCoverTemplateFields(process.cliente.razon);
      const coverData = await window.electronAPI.app.getProcessCoverMappedData(process);
      console.log('[React] Campos de PORTADA obtenidos:', coverFields);
      console.log('[React] Datos de PORTADA obtenidos:', coverData);
      setCoverTemplateFields(coverFields);
      setCoverMappedData(coverData);
      
      // Verificación de seguridad - si los campos son iguales, algo está mal
      if (JSON.stringify(fields) === JSON.stringify(coverFields)) {
        console.error('[React] ERROR: Los campos de demanda y portada son idénticos!');
        console.error('[React] Campos demanda:', fields);
        console.error('[React] Campos portada:', coverFields);
        
        // Forzar campos básicos de portada como fallback
        const basicCoverFields = ['JUZGADO', 'DOMICILIO', 'CUANTIA', 'DEMANDADO_1', 'DEMANDADO_2'];
        console.log('[React] Forzando campos básicos de portada:', basicCoverFields);
        setCoverTemplateFields(basicCoverFields);
        
        // Crear datos básicos de portada
        const basicCoverData = {
          'JUZGADO': data.JUZGADO || 'Juzgado Civil Municipal',
          'DOMICILIO': data.DOMICILIO || 'Bogotá D.C.',
          'CUANTIA': data.CUANTIA || 'MÍNIMA',
          'DEMANDADO_1': data.DEMANDADO_1 || data.DEMANDADO || '',
          'DEMANDADO_2': data.DEMANDADO_2 || ''
        };
        setCoverMappedData(basicCoverData);
      }
    }
    
    setScreen('processDetail');
  };

  const handleMappedDataChange = (e) => {
    setMappedData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  // Función para cargar datos de sincronización
  const loadSyncData = async () => {
    setSyncLoading(true);
    try {
      const [apiResult, localResult] = await Promise.all([
        window.electronAPI.app.getApiProcessIds(),
        window.electronAPI.app.getLocalProcessIds()
      ]);

      if (apiResult.success) {
        setApiIds(apiResult.data);
      } else {
        setSnackbar({ open: true, message: `Error API: ${apiResult.error}`, severity: 'error' });
      }

      if (localResult.success) {
        setLocalIds(localResult.data);
      } else {
        setSnackbar({ open: true, message: `Error Local: ${localResult.error}`, severity: 'error' });
      }

    } catch (error) {
      setSnackbar({ open: true, message: `Error cargando datos: ${error.message}`, severity: 'error' });
    } finally {
      setSyncLoading(false);
    }
  };

  // Función para sincronizar procesos
  const handleSyncProcesses = async () => {
    setSyncLoading(true);
    try {
      const result = await window.electronAPI.app.syncProcesses();
      setSyncStatus(result);
      setLastSync(new Date().toLocaleString());
      
      if (result.success) {
        setSnackbar({ 
          open: true, 
          message: `Sincronización completa. Eliminados ${result.removedCount} procesos obsoletos.`, 
          severity: 'success' 
        });
        // Recargar datos después de sincronizar
        await loadSyncData();
        
        // También recargar la lista principal de procesos si eliminamos algunos
        if (result.removedCount > 0) {
          const mainResult = await window.electronAPI.app.getProcesses();
          if (mainResult.data) {
            setProcesses(mainResult.data);
          }
        }
      } else {
        setSnackbar({ open: true, message: `Error en sincronización: ${result.error}`, severity: 'error' });
      }
    } catch (error) {
      setSnackbar({ open: true, message: `Error en sincronización: ${error.message}`, severity: 'error' });
    } finally {
      setSyncLoading(false);
    }
  };

  // Función para filtrar procesos por ID
  const getFilteredProcesses = () => {
    if (!searchTerm.trim()) {
      return processes;
    }
    return processes.filter(process => 
      process.proceso_id.toString().includes(searchTerm.trim())
    );
  };

  // Función para marcar proceso como procesado
  const markProcessAsCompleted = (processId) => {
    const newStatus = {
      ...processStatus,
      [processId]: 'completed'
    };
    setProcessStatus(newStatus);
    
    // Guardar en localStorage para persistencia
    try {
      localStorage.setItem('staffbot-process-status', JSON.stringify(newStatus));
    } catch (e) {
      console.warn('Error al guardar estado de procesos en localStorage:', e);
    }
  };

  // Función para marcar proceso como en progreso
  const markProcessAsInProgress = (processId) => {
    const newStatus = {
      ...processStatus,
      [processId]: 'in_progress'
    };
    setProcessStatus(newStatus);
    
    // Guardar en localStorage para persistencia
    try {
      localStorage.setItem('staffbot-process-status', JSON.stringify(newStatus));
    } catch (e) {
      console.warn('Error al guardar estado de procesos en localStorage:', e);
    }
  };

  // Función para obtener el estado de un proceso
  const getProcessStatus = (processId) => {
    return processStatus[processId] || 'pending';
  };

  const renderProcessList = () => {
    console.log('[React] Renderizando lista de procesos. Total de procesos en estado:', processes.length);
    console.log('[React] Procesos a mostrar:', processes);
    
    const filteredProcesses = getFilteredProcesses();
    
    return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ mb: 2 }}>
        Lista de Procesos
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Procesos del día disponibles para diligenciar.
      </Typography>
      
      {/* Buscador de procesos */}
      <Box sx={{ mb: 3 }}>
        <TextField
          fullWidth
          variant="outlined"
          placeholder="Buscar proceso por ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: (
              <Box sx={{ mr: 1 }}>🔍</Box>
            ),
          }}
          sx={{ maxWidth: 400 }}
        />
      </Box>
      
      <Typography variant="subtitle1" color="primary" sx={{ mb: 2 }}>
        Procesos mostrados: <strong>{filteredProcesses.length}</strong> de <strong>{processes.length}</strong> total
      </Typography>
      {loading && <Typography sx={{ mt: 2 }}>Cargando procesos desde la API...</Typography>}
      {error && <Chip label={error} color="error" sx={{ mt: 2 }} />}
      
      <Grid container spacing={3} sx={{ mt: 2 }}>
        {filteredProcesses.map((process) => {
          const status = getProcessStatus(process.proceso_id);
          return (
            <Grid item xs={12} md={6} lg={4} key={process.proceso_id}>
              <Card sx={{ 
                border: status === 'completed' ? '2px solid #4caf50' : 'none'
              }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Cliente: {process.cliente?.razon || 'No especificado'}
                  </Typography>
                  <Typography variant="body1" color="text.secondary">
                    Deudor: {process.deudor?.nombre || 'No especificado'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    ID Proceso: {process.proceso_id}
                  </Typography>
                </CardContent>
                <CardActions sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Chip 
                    label={status === 'completed' ? 'Completado' : 'Pendiente'}
                    color={status === 'completed' ? 'success' : 'warning'}
                    size="small"
                    icon={status === 'completed' ? <CheckCircleIcon /> : <StarIcon />}
                  />
                  <Button 
                    size="small" 
                    variant="contained"
                    onClick={() => handleProcessSelect(process)}
                    disabled={loading}
                  >
                    Ver Detalle
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          );
        })}
      </Grid>
      
      {/* Mensaje cuando no hay resultados de búsqueda */}
      {searchTerm && filteredProcesses.length === 0 && (
        <Box sx={{ textAlign: 'center', mt: 4 }}>
          <Typography variant="h6" color="text.secondary">
            No se encontraron procesos con ID: "{searchTerm}"
          </Typography>
          <Button 
            variant="outlined" 
            onClick={() => setSearchTerm('')}
            sx={{ mt: 2 }}
          >
            Limpiar búsqueda
          </Button>
        </Box>
      )}
    </Box>
  )};

  const renderProcessDetail = () => {
    const handleTabChange = (event, newValue) => {
      setDetailTab(newValue);
    };

    const handleDownloadDoc = async (docData) => {
      if (!docData || !docData.base64) {
        setSnackbar({ open: true, message: `Error: El documento '${docData.name || 'desconocido'}' no tiene contenido para descargar.`, severity: 'error' });
        return;
      }

      const defaultName = docData.name || 'documento.pdf';
      
      const saveResult = await window.electronAPI.dialog.saveFile(defaultName);
      if (!saveResult.success || !saveResult.filePath) {
        setSnackbar({ open: true, message: 'Descarga cancelada.', severity: 'info' });
        return;
      }

      const result = await window.electronAPI.pdf.base64ToPdf(docData.base64, saveResult.filePath);
      
      setSnackbar({
        open: true,
        message: result.message,
        severity: result.success ? 'success' : 'error',
      });
    };

    return (
      <Box>
        <Typography variant="h4" gutterBottom>Detalle del Proceso</Typography>
        <Typography variant="body1" color="text.secondary" gutterBottom>
          Cliente: <strong>{selectedProcess?.cliente?.razon}</strong> | Deudor: <strong>{selectedProcess?.deudor?.nombre}</strong> | Proceso ID: <strong>{selectedProcess?.proceso_id}</strong>
        </Typography>

        <Paper sx={{ mt: 2 }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={detailTab} onChange={handleTabChange} aria-label="pestañas de detalle">
              <Tab label="Datos de la Demanda" />
              <Tab label="Datos de la Portada" />
              <Tab label="Documentos Adjuntos" />
            </Tabs>
          </Box>

          {/* Panel Pestaña 1: Datos Demanda */}
          {detailTab === 0 && (
            <Box sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>Formulario de la Demanda</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Estos son los campos que se usarán para rellenar la plantilla. Los datos extraídos del pagaré y otros documentos se muestran aquí. Puedes editarlos antes de continuar.
              </Typography>
              <Typography variant="caption" color="primary" sx={{ display: 'block', mb: 1 }}>
                DEBUG: Campos de demanda ({templateFields.length}): {templateFields.join(', ')}
              </Typography>
              
              {mappedData ? (
               <Grid container spacing={2}>
                  {templateFields.map((field) => (
                    <Grid item xs={12} sm={6} md={4} key={field}>
                     <TextField
                        fullWidth
                        variant="outlined"
                        label={field}
                        name={field}
                        value={mappedData[field] || ''}
                        onChange={handleMappedDataChange}
                     />
                   </Grid>
                  ))}
               </Grid>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Cargando datos del proceso...
                </Typography>
              )}
            </Box>
          )}

          {/* Panel Pestaña 2: Datos Portada */}
          {detailTab === 1 && (
            <Box sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>Formulario de la Portada</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Estos son los campos que se usarán para rellenar la plantilla de portada. Los datos extraídos del proceso se muestran aquí. Puedes editarlos antes de continuar.
              </Typography>
              <Typography variant="caption" color="secondary" sx={{ display: 'block', mb: 1 }}>
                DEBUG: Campos de portada ({coverTemplateFields.length}): {coverTemplateFields.join(', ')}
              </Typography>
              
              {coverMappedData ? (
               <Grid container spacing={2}>
                  {coverTemplateFields.map((field) => (
                    <Grid item xs={12} sm={6} md={4} key={field}>
                     <TextField
                        fullWidth
                        variant="outlined"
                        label={field}
                        name={field}
                        value={coverMappedData[field] || ''}
                        onChange={handleCoverMappedDataChange}
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            backgroundColor: 'rgba(76, 175, 80, 0.04)', // Verde claro para diferenciarlo de demanda
                          }
                        }}
                     />
                   </Grid>
                  ))}
               </Grid>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Cargando datos de portada del proceso...
                </Typography>
              )}
              
              {coverTemplateFields.length === 0 && coverMappedData && (
                <Box sx={{ mt: 2, p: 2, bgcolor: 'warning.light', borderRadius: 1 }}>
                  <Typography variant="body2" color="warning.dark">
                    ⚠️ No se encontró plantilla de portada específica para esta entidad.
                  </Typography>
                </Box>
              )}
            </Box>
          )}
          
          {/* Panel Pestaña 3: Documentos Adjuntos */}
          {detailTab === 2 && (
            <Box sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>Documentos Adjuntos</Typography>
              {selectedProcess?.documentos && (
                (() => {
                  // Documentos individuales (ubica, poder, etc.)
                  const docsInd = Object.values(selectedProcess.documentos)
                    .filter(doc => doc && doc.filename && !Array.isArray(doc));
                  // Pagarés (array)
                  const pagarArray = Array.isArray(selectedProcess.documentos.pagares)
                    ? selectedProcess.documentos.pagares.filter(p => p && p.filename)
                    : [];
                  // Unir ambos para mostrar
                  const allDocs = [...docsInd, ...pagarArray];
                  return allDocs.length > 0 ? (
                    <MuiList>
                      {allDocs.map((doc, index) => (
                        <ListItem key={index} secondaryAction={
                          <Button 
                            variant="outlined" 
                            startIcon={<Download />}
                            onClick={() => handleDownloadDoc({ name: doc.filename, base64: doc.data })}
                            disabled={!doc.data}
                          >
                            Descargar
                          </Button>
                        }>
                          <ListItemIcon><DescriptionIcon /></ListItemIcon>
                          <ListItemText 
                            primary={doc.filename}
                            secondary={doc.data ? null : "Contenido no disponible"}
                          />
                        </ListItem>
                      ))}
                    </MuiList>
                  ) : (
                    <Typography sx={{ mt: 2 }}>No hay documentos adjuntos para este proceso.</Typography>
                  );
                })()
              )}
            </Box>
          )}

        </Paper>
        <Stack direction="row" spacing={2} sx={{ mt: 3, justifyContent: 'flex-start' }}>
          <Button
            variant="contained"
            color="primary"
            onClick={handleDiligenciar}
            disabled={diligenciando || !selectedProcess}
          >
            {diligenciando ? 'Generando Demanda...' : 'Generar Demanda'}
          </Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleGenerarPortada}
            disabled={generandoPortada || !selectedProcess}
          >
            {generandoPortada ? 'Generando Portada...' : 'Generar Portada'}
          </Button>
          <Button
            variant="outlined"
            onClick={() => setScreen('processList')}
          >
            Volver a la Lista
          </Button>
        </Stack>
      </Box>
    );
  };

  const renderDemandEditor = () => {
    // Si no hay proceso seleccionado o resultado, mostrar mensaje
    if (!selectedProcess || !resultadoFinal) {
      return (
        <Box>
          <Typography variant="h4" gutterBottom>
            Editor de Demanda
          </Typography>
          <Typography variant="body1" color="text.secondary" gutterBottom>
            No hay proceso seleccionado o datos de demanda disponibles.
          </Typography>
          <Button
            variant="outlined"
            onClick={() => setScreen('processList')}
            sx={{ mt: 2 }}
          >
            Volver a la Lista de Procesos
          </Button>
        </Box>
      );
    }

    // Función para regenerar el documento con cambios
    const handleRegenerateDocument = async () => {
      if (!selectedProcess) return;
      setDiligenciando(true);
      
      try {
        const resultado = await window.electronAPI.app.diligenciarDemanda(selectedProcess);
        setResultadoFinal(resultado);
        if (resultado.htmlContent) {
          setEditorContent(resultado.htmlContent);
        }
      } catch (error) {
        console.error('Error al regenerar documento:', error);
        setSnackbar({
          open: true,
          message: 'Error al regenerar documento: ' + error.message,
          severity: 'error'
        });
      } finally {
        setDiligenciando(false);
      }
    };

    // Función para hacer campos editables inline
    const handleFieldClick = (event) => {
      const field = event.target;
      if (field.classList.contains('field-highlight') && isEditing) {
        const currentValue = field.textContent;
        const fieldName = field.getAttribute('data-field');
        
        // Crear input temporal
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentValue;
        input.style.background = '#ffeb3b';
        input.style.border = '2px solid #ffc107';
        input.style.padding = '2px 4px';
        input.style.borderRadius = '3px';
        input.style.fontSize = 'inherit';
        input.style.fontFamily = 'inherit';
        input.style.width = Math.max(currentValue.length * 8, 100) + 'px';
        
        // Reemplazar temporalmente
        field.style.display = 'none';
        field.parentNode.insertBefore(input, field);
        input.focus();
        input.select();
        
        // Manejar guardado
        const saveField = async () => {
          const newValue = input.value;
          field.textContent = newValue;
          field.style.display = 'inline';
          input.remove();
          
          // Actualizar mappedData si existe
          if (mappedData && fieldName) {
            mappedData[fieldName] = newValue;
            
            // Guardar los cambios al backend
            try {
              await window.electronAPI.app.updateMappedData(selectedProcess.proceso_id, mappedData);
              setSnackbar({
                open: true,
                message: `Campo ${fieldName} actualizado y guardado: "${newValue}"`,
                severity: 'success'
              });
            } catch (error) {
              console.error('Error al guardar cambios:', error);
              setSnackbar({
                open: true,
                message: `Error al guardar cambios en ${fieldName}`,
                severity: 'error'
              });
            }
          } else {
            setSnackbar({
              open: true,
              message: `Campo ${fieldName} actualizado: "${newValue}"`,
              severity: 'success'
            });
          }
        };
        
        // Eventos
        input.addEventListener('blur', saveField);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            saveField();
          } else if (e.key === 'Escape') {
            field.style.display = 'inline';
            input.remove();
          }
        });
      }
    };

    return (
      <Box>
        {/* Header */}
        <Box sx={{ mb: 3, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="h4" gutterBottom>
            📄 Editor de Demanda - {selectedProcess.cliente?.razon}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Proceso ID: <strong>{selectedProcess.proceso_id}</strong> | 
            Deudor: <strong>{selectedProcess.deudor?.nombre}</strong>
          </Typography>
          
          {/* Barra de herramientas */}
          <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
            <Button
              variant="contained"
              color="primary"
              onClick={handleOpenFieldEditor}
              startIcon={<Edit />}
              disabled={!currentMappedData}
            >
              Editar Campos
            </Button>
            <Button
              variant="outlined"
              onClick={handleRegenerateDocument}
              disabled={diligenciando}
              startIcon={<Refresh />}
            >
              {diligenciando ? 'Regenerando...' : 'Regenerar'}
            </Button>
            <Button
              variant="contained"
              startIcon={<Download />}
              onClick={() => {
                if (resultadoFinal.filePath) {
                  window.electronAPI.shell.openFile(resultadoFinal.filePath);
                }
              }}
              disabled={!resultadoFinal.filePath}
            >
              Abrir Word
            </Button>
            <Button
              variant="outlined"
              startIcon={<PictureAsPdf />}
              onClick={() => {
                setSnackbar({
                  open: true,
                  message: 'Función de exportar a PDF en desarrollo',
                  severity: 'info'
                });
              }}
            >
              Exportar PDF
            </Button>
          </Stack>
        </Box>

        {/* Indicador de modo edición */}
        {isEditing && (
          <Alert severity="info" sx={{ mb: 3 }}>
            <Typography variant="body2">
              <strong>Modo Edición Activo:</strong> Haz clic en los campos resaltados (amarillo) para editarlos directamente.
            </Typography>
          </Alert>
        )}

        {/* Indicador de carga */}
        {diligenciando && (
          <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={20} />
            <Typography>Procesando demanda, por favor espere...</Typography>
          </Box>
        )}
        
        {/* Mensaje de error */}
        {resultadoFinal && !resultadoFinal.success && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {resultadoFinal.message}
          </Alert>
        )}

        {/* Información del documento */}
        {resultadoFinal && resultadoFinal.success && resultadoFinal.filePath && (
          <Box sx={{ mb: 3, p: 2, bgcolor: 'success.light', borderRadius: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'success.dark' }}>
              ✓ Documento generado exitosamente
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Archivo: {resultadoFinal.filePath.split('/').pop()}
            </Typography>
          </Box>
        )}

        {/* Editor WYSIWYG Principal - CONSERVANDO LA ESTRUCTURA ORIGINAL */}
        {resultadoFinal && resultadoFinal.success && (
          <Paper sx={{ p: 0, overflow: 'hidden' }}>
            <Box sx={{ p: 2, bgcolor: 'primary.main', color: 'white' }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Visibility />
                Contenido de la Demanda
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                Los campos resaltados en amarillo fueron extraídos automáticamente. 
                {isEditing ? ' Haz clic en ellos para editarlos.' : ' Activa el modo edición para modificarlos.'}
              </Typography>
            </Box>
            
            <Box sx={{ minHeight: 600 }}>
              <Box 
                onClick={handleFieldClick}
                sx={{ 
                  p: 3, 
                  minHeight: 500,
                  '& .field-highlight': {
                    backgroundColor: '#ffeb3b !important',
                    padding: '2px 4px',
                    borderRadius: '2px',
                    cursor: isEditing ? 'pointer' : 'default',
                    border: isEditing ? '1px dashed #ffc107' : 'none',
                    '&:hover': isEditing ? {
                      backgroundColor: '#ffc107 !important',
                      boxShadow: '0 0 0 2px rgba(25, 118, 210, 0.2)'
                    } : {}
                  }
                }}
                dangerouslySetInnerHTML={{ __html: editorContent }}
              />
            </Box>
          </Paper>
        )}

        {/* Botones de navegación */}
        <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
          <Button
            variant="outlined"
            onClick={() => setScreen('processDetail')}
          >
            ← Volver al Detalle
          </Button>
          <Button
            variant="outlined"
            onClick={() => setScreen('processList')}
          >
            ← Volver a la Lista
          </Button>
        </Stack>
      </Box>
    );
  };

  const renderLocalHistory = () => {
    // Filtrar procesos que han sido trabajados (completados o en proceso)
    const workedProcesses = processes.filter(process => {
      const status = getProcessStatus(process.proceso_id);
      return status === 'completed' || status === 'in_progress';
    });

    // Obtener la fecha actual para mostrar procesos de hoy
    const today = new Date().toISOString().split('T')[0];
    
    return (
      <Box>
        <Typography variant="h4" gutterBottom>
          Historial Local
        </Typography>
        <Typography variant="body1" color="text.secondary" gutterBottom>
          Procesos trabajados hoy (offline/online)
        </Typography>
        
        {/* Indicador de procesos trabajados */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Total de procesos trabajados: {workedProcesses.length}
          </Typography>
        </Box>
        
        {workedProcesses.length > 0 ? (
          <Grid container spacing={3} sx={{ mt: 2 }}>
            {workedProcesses.map((process) => {
              const status = getProcessStatus(process.proceso_id);
              const statusLabel = status === 'completed' ? 'Completada' : 'En proceso';
              const statusColor = status === 'completed' ? 'success' : 'warning';
              
              return (
                <Grid item xs={12} md={6} lg={4} key={process.proceso_id}>
                  <Card sx={{ 
                    border: status === 'completed' ? '2px solid #4caf50' : '2px solid #ff9800'
                  }}>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        {process.cliente?.razon || 'Cliente no especificado'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Deudor: {process.deudor?.nombre || 'No especificado'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                        ID Proceso: {process.proceso_id}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Procesado: {today}
                      </Typography>
                      <Chip 
                        label={statusLabel} 
                        color={statusColor}
                        size="small"
                        sx={{ mt: 1 }}
                        icon={status === 'completed' ? <CheckCircleIcon /> : <StarIcon />}
                      />
                    </CardContent>
                    <CardActions>
                      <Button 
                        size="small" 
                        variant="outlined"
                        onClick={() => handleProcessSelect(process)}
                      >
                        Continuar
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        ) : (
          <Paper sx={{ p: 3, mt: 2, textAlign: 'center' }}>
            <Typography variant="h6" color="text.secondary">
              No hay procesos trabajados aún
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Los procesos aparecerán aquí cuando los procesamientos se completen.
            </Typography>
            <Button 
              variant="contained" 
              onClick={() => setScreen('processList')}
              sx={{ mt: 2 }}
            >
              Ir a Lista de Procesos
            </Button>
          </Paper>
        )}
        
        <Box sx={{ mt: 3 }}>
          <Button 
            variant="outlined" 
            onClick={() => setScreen('processList')}
          >
            Volver a la Lista
          </Button>
        </Box>
      </Box>
    );
  };

    const renderConfigScreen = () => {
    // Encontrar diferencias
    const onlyInApi = apiIds.filter(id => !localIds.includes(id));
    const onlyInLocal = localIds.filter(id => !apiIds.includes(id));
    const inBoth = apiIds.filter(id => localIds.includes(id));

    return (
      <Box>
        <Typography variant="h4" gutterBottom>
          Estado y Configuración del Sistema
        </Typography>
        <Typography variant="body1" color="text.secondary" gutterBottom>
          Control de sincronización entre API y caché local de procesos.
        </Typography>

        {/* Estadísticas Generales */}
        <Grid container spacing={3} sx={{ mt: 2 }}>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" color="primary">API Remota</Typography>
                <Typography variant="h4">{apiIds.length}</Typography>
                <Typography variant="body2" color="text.secondary">Procesos disponibles</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" color="secondary">Caché Local</Typography>
                <Typography variant="h4">{localIds.length}</Typography>
                <Typography variant="body2" color="text.secondary">Procesos almacenados</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" color="success.main">Sincronizados</Typography>
                <Typography variant="h4">{inBoth.length}</Typography>
                <Typography variant="body2" color="text.secondary">Procesos coincidentes</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Controles de Sincronización */}
        <Paper sx={{ p: 3, mt: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Control de Sincronización</Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
                             <Button
                 variant="outlined"
                 onClick={loadSyncData}
                 disabled={syncLoading}
                 startIcon={<Refresh />}
               >
                 Actualizar
               </Button>
               <Button
                 variant="contained"
                 onClick={handleSyncProcesses}
                 disabled={syncLoading}
                 startIcon={<CheckCircleIcon />}
               >
                 {syncLoading ? 'Sincronizando...' : 'Sincronizar Ahora'}
               </Button>
            </Box>
          </Box>
          
          {lastSync && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Última sincronización: {lastSync}
            </Typography>
          )}

          {/* Alertas de Estado */}
          {onlyInLocal.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>{onlyInLocal.length} procesos obsoletos</strong> en caché local que ya no están en la API.
              <br />
              IDs: {onlyInLocal.slice(0, 10).join(', ')}{onlyInLocal.length > 10 ? '...' : ''}
            </Alert>
          )}
          
          {onlyInApi.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <strong>{onlyInApi.length} procesos nuevos</strong> en la API que no están en caché local.
              <br />
              IDs: {onlyInApi.slice(0, 10).join(', ')}{onlyInApi.length > 10 ? '...' : ''}
            </Alert>
          )}

          {onlyInLocal.length === 0 && onlyInApi.length === 0 && apiIds.length > 0 && (
            <Alert severity="success">
              ✅ Todos los procesos están sincronizados correctamente.
            </Alert>
          )}
        </Paper>

        {/* Listados Detallados */}
        <Tabs value={0} sx={{ mt: 3 }}>
          <Tab label={`IDs API (${apiIds.length})`} />
          <Tab label={`IDs Local (${localIds.length})`} />
          <Tab label={`Solo API (${onlyInApi.length})`} />
          <Tab label={`Solo Local (${onlyInLocal.length})`} />
        </Tabs>
        
        <Paper sx={{ p: 2, mt: 1, maxHeight: 300, overflow: 'auto' }}>
          <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            API IDs: {JSON.stringify(apiIds, null, 2)}
            {'\n\n'}
            Local IDs: {JSON.stringify(localIds, null, 2)}
            {'\n\n'}
            Solo en API: {JSON.stringify(onlyInApi, null, 2)}
            {'\n\n'}
            Solo en Local: {JSON.stringify(onlyInLocal, null, 2)}
          </Typography>
        </Paper>

        {/* Pruebas de Conexión Originales */}
        <Paper sx={{ p: 3, mt: 3 }}>
          <Typography variant="h6" gutterBottom>Pruebas de Conexión</Typography>
          <Stack spacing={2} divider={<Divider />}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography>API de Lista de Procesos</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {apiStatus.processes === 'success' && <Chip icon={<CheckCircleIcon />} label="Conexión Exitosa" color="success" />}
                {apiStatus.processes === 'error' && <Chip icon={<ErrorIcon />} label="Fallo la Conexión" color="error" />}
                <Button
                  variant="outlined"
                  onClick={() => handleTestApi('processes')}
                  disabled={testingApi === 'processes'}
                >
                  {testingApi === 'processes' ? 'Probando...' : 'Probar'}
                </Button>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography>API de Detalle de Documentos</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {apiStatus.documents === 'success' && <Chip icon={<CheckCircleIcon />} label="Conexión Exitosa" color="success" />}
                {apiStatus.documents === 'error' && <Chip icon={<ErrorIcon />} label="Fallo la Conexión" color="error" />}
                <Button
                  variant="outlined"
                  onClick={() => handleTestApi('documents')}
                  disabled={testingApi === 'documents'}
                >
                  {testingApi === 'documents' ? 'Probando...' : 'Probar'}
                </Button>
              </Box>
            </Box>
          </Stack>
        </Paper>
      </Box>
    );
  };

  const handleSnackbarClose = (event, reason) => {
    if (reason === 'clickaway') {
      return;
    }
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <Drawer variant="permanent" anchor="left" sx={{ width: 240 }}>
        <Toolbar />
        <Box sx={{ overflow: 'auto' }}>
          <MuiList>
            {screens.map((s) => (
              <ListItemButton
                key={s.key} 
                selected={screen === s.key} 
                onClick={() => setScreen(s.key)}
              >
                <Box sx={{ mr: 2 }}>{s.icon}</Box>
                <ListItemText primary={s.label} />
              </ListItemButton>
            ))}
          </MuiList>
        </Box>
      </Drawer>
      
      <Box component="main" sx={{ flexGrow: 1, overflow: 'auto' }}>
        <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
          <Toolbar>
            <Typography variant="h6" noWrap component="div">
              Diligenciador de Demandas
            </Typography>
          </Toolbar>
        </AppBar>
        <Toolbar />
        
        <Container maxWidth="lg" sx={{ p: 3 }}>
          {screen === 'processList' && renderProcessList()}
          {screen === 'processDetail' && renderProcessDetail()}
          {screen === 'demandEditor' && renderDemandEditor()}
          {screen === 'localHistory' && renderLocalHistory()}
          {screen === 'config' && renderConfigScreen()}
        </Container>
      </Box>

      {/* Editor de Campos */}
      <FieldEditor
        open={fieldEditorOpen}
        onClose={() => setFieldEditorOpen(false)}
        mappedData={currentMappedData}
        onSave={handleSaveEditedFields}
        processId={selectedProcess?.proceso_id}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default App;
