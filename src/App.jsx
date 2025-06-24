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

const screens = [
  { key: 'processList', label: 'Lista de procesos', icon: <ListIcon /> },
  { key: 'processDetail', label: 'Detalle de proceso', icon: <Description /> },
  { key: 'demandEditor', label: 'Editor de demanda', icon: <Edit /> },
  { key: 'localHistory', label: 'Historial local', icon: <History /> },
  { key: 'config', label: 'Configuración', icon: <SettingsIcon /> },
];

// Datos simulados para la demo
const mockProcesses = [
  { id: 1, name: 'Demanda Bancamia', status: 'Pendiente', date: '2024-01-15', entity: 'Bancamia' },
  { id: 2, name: 'Demanda Contactar', status: 'En proceso', date: '2024-01-14', entity: 'Banco Contactar' },
  { id: 3, name: 'Demanda CFA', status: 'Completada', date: '2024-01-13', entity: 'CFA' },
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
  const [resultadoFinal, setResultadoFinal] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [apiStatus, setApiStatus] = useState({ processes: null, documents: null });
  const [testingApi, setTestingApi] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  
  // Estados para el editor WYSIWYG
  const [editorContent, setEditorContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);

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

  const fetchProcessDetails = async (processId) => {
    // Ya no necesitamos esta función, la lógica se mueve al diligenciamiento.
    // Simplemente seleccionamos el proceso de la lista que ya tenemos.
    const process = processes.find(p => p.id === processId);
    setSelectedProcess(process);
    setScreen('processDetail');
  };

  const handleDiligenciar = () => {
    if (!selectedProcess) return;
    setDiligenciando(true);
    setResultadoFinal(null);
    window.electronAPI.app.diligenciarDemanda(selectedProcess).then(resultado => {
      setDiligenciando(false);
      setResultadoFinal(resultado);
      
      // Si el diligenciado fue exitoso, navegar automáticamente al Editor de Demanda
      if (resultado.success) {
        setScreen('demandEditor');
      }
    });
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

  const handleProcessSelect = async (process) => {
    setSelectedProcess(process);
    setDetailTab(0);
    setTemplateFields([]); 
    setMappedData(null); // Limpiamos los datos anteriores

    // Usamos el nombre del cliente para buscar su plantilla
    if (process.cliente?.razon) {
      // Obtenemos tanto los campos requeridos como los datos ya mapeados
      const fields = await window.electronAPI.app.getTemplateFields(process.cliente.razon);
      const data = await window.electronAPI.app.getProcessMappedData(process);
      setTemplateFields(fields);
      setMappedData(data);
    }
    
    setScreen('processDetail');
  };

  const handleMappedDataChange = (e) => {
    setMappedData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const renderProcessList = () => {
    console.log('[React] Renderizando lista de procesos. Total de procesos en estado:', processes.length);
    console.log('[React] Procesos a mostrar:', processes);
    
    return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Lista de Procesos
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Procesos del día disponibles para diligenciar.
      </Typography>
      <Typography variant="subtitle1" color="primary" sx={{ mb: 2 }}>
        Procesos listados: <strong>{processes.length}</strong>
      </Typography>
      {loading && <Typography sx={{ mt: 2 }}>Cargando procesos desde la API...</Typography>}
      {error && <Chip label={error} color="error" sx={{ mt: 2 }} />}
      
      <Grid container spacing={3} sx={{ mt: 2 }}>
        {processes.map((process) => (
          <Grid item xs={12} md={6} lg={4} key={process.proceso_id}>
            <Card>
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
              <CardActions>
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
        ))}
      </Grid>
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
                        onChange={handleDataChange}
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
              <Typography>Aquí irán los campos específicos para la portada.</Typography>
            </Box>
          )}
          
          {/* Panel Pestaña 3: Documentos Adjuntos */}
          {detailTab === 2 && (
            <Box sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>Documentos Adjuntos</Typography>
              {selectedProcess?.documentos && Object.values(selectedProcess.documentos).filter(doc => doc && doc.filename).length > 0 ? (
                <MuiList>
                  {Object.values(selectedProcess.documentos).filter(doc => doc && doc.filename).map((doc, index) => (
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

    // Configuración del editor Quill
    const quillModules = {
      toolbar: [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'align': [] }],
        ['clean']
      ],
    };

    const quillFormats = [
      'header', 'bold', 'italic', 'underline',
      'list', 'bullet', 'align'
    ];

    // Función para regenerar el documento con cambios
    const handleRegenerateDocument = async () => {
      if (!selectedProcess) return;
      setDiligenciando(true);
      
      try {
        const resultado = await window.electronAPI.app.diligenciarDemanda(selectedProcess);
        setResultadoFinal(resultado);
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
              variant={isEditing ? "contained" : "outlined"}
              color="primary"
              onClick={() => setIsEditing(!isEditing)}
              startIcon={<Edit />}
            >
              {isEditing ? 'Modo Lectura' : 'Modo Edición'}
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

        {/* Editor WYSIWYG Principal */}
        {resultadoFinal && resultadoFinal.success && (
          <Paper sx={{ p: 0, overflow: 'hidden' }}>
            <Box sx={{ p: 2, bgcolor: 'primary.main', color: 'white' }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Visibility />
                Contenido de la Demanda
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                Los campos resaltados en amarillo fueron extraídos automáticamente. 
                {isEditing ? ' Puedes editarlos directamente en el texto.' : ' Activa el modo edición para modificarlos.'}
              </Typography>
            </Box>
            
            <Box sx={{ minHeight: 600 }}>
              {isEditing ? (
                <ReactQuill
                  theme="snow"
                  value={editorContent}
                  onChange={setEditorContent}
                  modules={quillModules}
                  formats={quillFormats}
                  style={{ height: '500px' }}
                />
              ) : (
                <Box 
                  sx={{ 
                    p: 3, 
                    minHeight: 500,
                    '& .field-highlight': {
                      backgroundColor: '#ffeb3b !important',
                      padding: '2px 4px',
                      borderRadius: '2px',
                      cursor: 'pointer',
                      '&:hover': {
                        backgroundColor: '#ffc107 !important',
                        boxShadow: '0 0 0 2px rgba(25, 118, 210, 0.2)'
                      }
                    }
                  }}
                  dangerouslySetInnerHTML={{ __html: editorContent }}
                />
              )}
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

  const renderLocalHistory = () => (
    <Box>
      <Typography variant="h4" gutterBottom>
        Historial Local
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Procesos trabajados hoy (offline/online)
      </Typography>
      
      <Grid container spacing={3} sx={{ mt: 2 }}>
        {mockProcesses.map((process) => (
          <Grid xs={12} md={6} lg={4} key={process.id}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {process.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Última modificación: {process.date}
                </Typography>
                <Chip 
                  label={process.status} 
                  color={process.status === 'Completada' ? 'success' : 'default'}
                  size="small"
                  sx={{ mt: 1 }}
                />
              </CardContent>
              <CardActions>
                <Button size="small" variant="outlined">
                  Continuar
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
      
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

  const renderConfigScreen = () => (
    <Box>
      <Typography variant="h4" gutterBottom>
        Estado y Configuración del Sistema
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Verifica el estado de la conexión con los servicios de la API.
      </Typography>

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
