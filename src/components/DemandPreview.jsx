import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Divider,
  Grid,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  Edit as EditIcon,
  Download as DownloadIcon,
  Close as CloseIcon
} from '@mui/icons-material';

const DemandPreview = ({ 
  process, 
  mappedData, 
  isOpen, 
  onClose, 
  onEdit,
  onGenerate 
}) => {
  if (!process || !mappedData) {
    return null;
  }

  const formatFieldValue = (value) => {
    if (!value || value === '') return 'No disponible';
    return value;
  };

  const getEntityLogo = (entityName) => {
    // Mapeo de entidades a colores/logos (puede expandirse)
    const entityColors = {
      'Coopemsura': '#1976d2',
      'Bancamia': '#2e7d32',
      'Bancoomeva': '#ed6c02',
      'CFA': '#9c27b0',
      'Cobelen': '#d32f2f',
      'JFK': '#1565c0',
      'Juriscoop': '#388e3c',
      'Pichincha': '#f57c00',
      'Progresa': '#7b1fa2',
      'UMA': '#c62828'
    };
    
    return entityColors[entityName] || '#666666';
  };

  const renderHeader = () => (
    <Box sx={{ 
      borderBottom: '2px solid #1976d2', 
      pb: 2, 
      mb: 3,
      position: 'relative'
    }}>
      {/* Logo/Header de la entidad */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        mb: 2
      }}>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2
        }}>
          <Box sx={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            backgroundColor: getEntityLogo(process.entidad),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 'bold',
            fontSize: '1.2rem'
          }}>
            {process.entidad?.substring(0, 2).toUpperCase()}
          </Box>
          <Box>
            <Typography variant="h5" fontWeight="bold" color="primary">
              {process.entidad || 'Entidad'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Proceso #{process.proceso_id}
            </Typography>
          </Box>
        </Box>
        
        <Chip 
          label="DEMANDA JUDICIAL" 
          color="primary" 
          variant="outlined"
          sx={{ fontWeight: 'bold' }}
        />
      </Box>

      {/* Información del proceso */}
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Typography variant="body2" color="text.secondary">
            <strong>Cliente:</strong> {formatFieldValue(process.cliente?.nombre)}
          </Typography>
        </Grid>
        <Grid item xs={12} md={6}>
          <Typography variant="body2" color="text.secondary">
            <strong>Fecha:</strong> {new Date().toLocaleDateString('es-ES')}
          </Typography>
        </Grid>
      </Grid>
    </Box>
  );

  const renderDemandData = () => (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" gutterBottom sx={{ color: 'primary.main', fontWeight: 'bold' }}>
        DATOS DE LA DEMANDA
      </Typography>
      
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              JUZGADO
            </Typography>
            <Typography variant="body1" sx={{ 
              p: 1, 
              bgcolor: 'grey.50', 
              borderRadius: 1,
              border: '1px solid #e0e0e0'
            }}>
              {formatFieldValue(mappedData.JUZGADO)}
            </Typography>
          </Box>
        </Grid>
        
        <Grid item xs={12} md={6}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              DOMICILIO
            </Typography>
            <Typography variant="body1" sx={{ 
              p: 1, 
              bgcolor: 'grey.50', 
              borderRadius: 1,
              border: '1px solid #e0e0e0'
            }}>
              {formatFieldValue(mappedData.DOMICILIO)}
            </Typography>
          </Box>
        </Grid>

        <Grid item xs={12} md={6}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              CUANTÍA
            </Typography>
            <Typography variant="body1" sx={{ 
              p: 1, 
              bgcolor: 'grey.50', 
              borderRadius: 1,
              border: '1px solid #e0e0e0'
            }}>
              {formatFieldValue(mappedData.CUANTIA)}
            </Typography>
          </Box>
        </Grid>

        <Grid item xs={12} md={6}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              DIRECCIÓN NOTIFICACIÓN
            </Typography>
            <Typography variant="body1" sx={{ 
              p: 1, 
              bgcolor: 'grey.50', 
              borderRadius: 1,
              border: '1px solid #e0e0e0'
            }}>
              {formatFieldValue(mappedData.DIRECCION_NOTIFICACION)}
            </Typography>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );

  const renderDefendants = () => (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" gutterBottom sx={{ color: 'primary.main', fontWeight: 'bold' }}>
        DEMANDADOS
      </Typography>
      
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              DEMANDADO 1
            </Typography>
            <Typography variant="body1" sx={{ 
              p: 1, 
              bgcolor: 'grey.50', 
              borderRadius: 1,
              border: '1px solid #e0e0e0'
            }}>
              {formatFieldValue(mappedData.DEMANDADO_1)}
            </Typography>
          </Box>
        </Grid>
        
        <Grid item xs={12} md={6}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              DEMANDADO 2
            </Typography>
            <Typography variant="body1" sx={{ 
              p: 1, 
              bgcolor: 'grey.50', 
              borderRadius: 1,
              border: '1px solid #e0e0e0'
            }}>
              {formatFieldValue(mappedData.DEMANDADO_2)}
            </Typography>
          </Box>
        </Grid>

        <Grid item xs={12} md={6}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              CORREO ELECTRÓNICO
            </Typography>
            <Typography variant="body1" sx={{ 
              p: 1, 
              bgcolor: 'grey.50', 
              borderRadius: 1,
              border: '1px solid #e0e0e0'
            }}>
              {formatFieldValue(mappedData.CORREO)}
            </Typography>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );

  const renderSignature = () => (
    <Box sx={{ 
      mt: 6, 
      pt: 3, 
      borderTop: '1px solid #e0e0e0',
      textAlign: 'center'
    }}>
      <Typography variant="h6" gutterBottom sx={{ color: 'primary.main', fontWeight: 'bold' }}>
        FIRMA Y AUTORIZACIÓN
      </Typography>
      
      <Box sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        mt: 4
      }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Firma Digital Autorizada
          </Typography>
          <Box sx={{
            width: 200,
            height: 80,
            border: '2px dashed #ccc',
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'grey.50'
          }}>
            <Typography variant="body2" color="text.secondary">
              {process.firma ? 'Firma cargada' : 'Firma no disponible'}
            </Typography>
          </Box>
          {process.firma && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Firma válida hasta: {new Date().toLocaleDateString('es-ES')}
            </Typography>
          )}
        </Box>
        
        <Box sx={{ flex: 1, textAlign: 'right' }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Fecha de Generación
          </Typography>
          <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
            {new Date().toLocaleDateString('es-ES', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Hora: {new Date().toLocaleTimeString('es-ES')}
          </Typography>
        </Box>
      </Box>
    </Box>
  );

  const renderValidationSummary = () => {
    const requiredFields = [
      { key: 'DEMANDADO_1', label: 'Demandado 1', value: mappedData.DEMANDADO_1 },
      { key: 'JUZGADO', label: 'Juzgado', value: mappedData.JUZGADO },
      { key: 'DOMICILIO', label: 'Domicilio', value: mappedData.DOMICILIO }
    ];
    
    const missingFields = requiredFields.filter(field => !field.value || field.value === '');
    const isValid = missingFields.length === 0;

    return (
      <Box sx={{ 
        mt: 3, 
        p: 2, 
        bgcolor: isValid ? 'success.50' : 'warning.50',
        borderRadius: 1,
        border: `1px solid ${isValid ? 'success.200' : 'warning.200'}`
      }}>
        <Typography variant="subtitle2" gutterBottom sx={{ 
          color: isValid ? 'success.main' : 'warning.main',
          fontWeight: 'bold'
        }}>
          {isValid ? '✓ Datos completos' : '⚠ Datos incompletos'}
        </Typography>
        
        {!isValid && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Campos faltantes:
            </Typography>
            <Box component="ul" sx={{ pl: 2, m: 0 }}>
              {missingFields.map(field => (
                <Typography key={field.key} component="li" variant="body2" color="text.secondary">
                  {field.label}
                </Typography>
              ))}
            </Box>
          </Box>
        )}
        
        {isValid && (
          <Typography variant="body2" color="success.main">
            Todos los campos requeridos están completos. El documento está listo para generar.
          </Typography>
        )}
      </Box>
    );
  };

  return (
    <Dialog 
      open={isOpen} 
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { 
          minHeight: '80vh',
          maxHeight: '90vh'
        }
      }}
    >
      <DialogTitle sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        borderBottom: '1px solid #e0e0e0'
      }}>
        <Typography variant="h5" fontWeight="bold">
          Previsualización de Demanda
        </Typography>
        <Box>
          <Tooltip title="Editar datos">
            <IconButton onClick={onEdit} color="primary">
              <EditIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Generar documento">
            <IconButton onClick={onGenerate} color="success">
              <DownloadIcon />
            </IconButton>
          </Tooltip>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 3 }}>
        <Paper elevation={2} sx={{ p: 4, minHeight: '60vh' }}>
          {renderHeader()}
          {renderDemandData()}
          {renderDefendants()}
          {renderSignature()}
          {renderValidationSummary()}
        </Paper>
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: '1px solid #e0e0e0' }}>
        <Button onClick={onClose} variant="outlined">
          Cerrar
        </Button>
        <Button onClick={onEdit} variant="outlined" startIcon={<EditIcon />}>
          Editar Datos
        </Button>
        <Button onClick={onGenerate} variant="contained" startIcon={<DownloadIcon />}>
          Generar Demanda
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DemandPreview; 