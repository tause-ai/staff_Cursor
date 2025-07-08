import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Grid,
  Typography,
  Box,
  Divider,
  Chip,
  Alert,
  LinearProgress
} from '@mui/material';
import { Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';

const FieldEditor = ({ open, onClose, mappedData, onSave, processId }) => {
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (mappedData) {
      setFormData({ ...mappedData });
      setHasChanges(false);
    }
  }, [mappedData]);

  const handleFieldChange = (fieldName, value) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(formData);
      setHasChanges(false);
      onClose();
    } catch (error) {
      console.error('Error al guardar:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (hasChanges) {
      if (window.confirm('¿Estás seguro de cancelar? Se perderán los cambios no guardados.')) {
        setFormData({ ...mappedData });
        setHasChanges(false);
        onClose();
      }
    } else {
      onClose();
    }
  };

  // Agrupar campos por categorías para mejor organización
  const getFieldCategory = (fieldName) => {
    if (fieldName.includes('JUZGADO') || fieldName.includes('DOMICILIO') || fieldName.includes('CUANTIA')) {
      return 'Información del Juzgado';
    }
    if (fieldName.includes('DEMANDADO') || fieldName.includes('DEUDOR')) {
      return 'Información del Demandado';
    }
    if (fieldName.includes('PAGARE') || fieldName.includes('VENCIMIENTO') || fieldName.includes('CAPITAL') || fieldName.includes('INTERES')) {
      return 'Información del Pagaré';
    }
    if (fieldName.includes('DIRECCION') || fieldName.includes('CORREO')) {
      return 'Información de Notificación';
    }
    return 'Otros Campos';
  };

  const groupedFields = Object.keys(formData).reduce((groups, fieldName) => {
    const category = getFieldCategory(fieldName);
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(fieldName);
    return groups;
  }, {});

  const getFieldLabel = (fieldName) => {
    const labels = {
      'JUZGADO': 'Juzgado',
      'DOMICILIO': 'Domicilio',
      'CUANTIA': 'Cuantía',
      'DEMANDADO_1': 'Demandado Principal',
      'DEMANDADO_2': 'Demandado Secundario',
      'PAGARE': 'Número de Pagaré Principal',
      'PAGARE_2': 'Número de Pagaré 2',
      'PAGARE_3': 'Número de Pagaré 3',
      'VENCIMIENTO': 'Fecha Vencimiento Principal',
      'VENCIMIENTO_2': 'Fecha Vencimiento 2',
      'VENCIMIENTO_3': 'Fecha Vencimiento 3',
      'CAPITAL_INSOLUTO': 'Capital Principal',
      'CAPITAL_INSOLUTO_2': 'Capital 2',
      'CAPITAL_INSOLUTO_3': 'Capital 3',
      'INTERES_MORA': 'Fecha Mora Principal',
      'INTERES_MORA_2': 'Fecha Mora 2',
      'INTERES_MORA_3': 'Fecha Mora 3',
      'DIRECCION_NOTIFICACION': 'Dirección Notificación Principal',
      'DIRECCION_NOTIFICACION_2': 'Dirección Notificación 2',
      'CORREO': 'Correo Principal',
      'CORREO_2': 'Correo 2'
    };
    return labels[fieldName] || fieldName.replace(/_/g, ' ');
  };

  const isFieldEmpty = (value) => {
    return !value || value.toString().trim() === '';
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleCancel} 
      maxWidth="lg" 
      fullWidth
      scroll="paper"
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">
            Editor de Campos - Proceso {processId}
          </Typography>
          {hasChanges && (
            <Chip 
              label="Cambios sin guardar" 
              color="warning" 
              size="small" 
            />
          )}
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {saving && <LinearProgress sx={{ mb: 2 }} />}
        
        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="body2">
            <strong>Instrucciones:</strong><br/>
            • Edita los campos necesarios para la demanda<br/>
            • Los campos vacíos se eliminarán automáticamente del documento final<br/>
            • Los cambios se aplicarán cuando regeneres el documento
          </Typography>
        </Alert>

        {Object.keys(groupedFields).map(category => (
          <Box key={category} sx={{ mb: 4 }}>
            <Typography variant="h6" color="primary" gutterBottom>
              {category}
            </Typography>
            <Divider sx={{ mb: 2 }} />
            
            <Grid container spacing={2}>
              {groupedFields[category].map(fieldName => (
                <Grid item xs={12} md={6} key={fieldName}>
                  <TextField
                    fullWidth
                    label={getFieldLabel(fieldName)}
                    value={formData[fieldName] || ''}
                    onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                    multiline={fieldName.includes('CAPITAL') || fieldName.includes('DIRECCION')}
                    rows={fieldName.includes('CAPITAL') ? 3 : (fieldName.includes('DIRECCION') ? 2 : 1)}
                    variant="outlined"
                    size="small"
                    helperText={
                      isFieldEmpty(formData[fieldName]) 
                        ? "Campo vacío - se eliminará del documento"
                        : `Campo: ${fieldName}`
                    }
                    sx={{
                      '& .MuiFormHelperText-root': {
                        color: isFieldEmpty(formData[fieldName]) ? 'warning.main' : 'text.secondary'
                      }
                    }}
                  />
                </Grid>
              ))}
            </Grid>
          </Box>
        ))}
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button 
          onClick={handleCancel}
          startIcon={<CancelIcon />}
          disabled={saving}
        >
          Cancelar
        </Button>
        <Button 
          onClick={handleSave}
          variant="contained"
          startIcon={<SaveIcon />}
          disabled={saving || !hasChanges}
        >
          {saving ? 'Guardando...' : 'Guardar Cambios'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FieldEditor; 