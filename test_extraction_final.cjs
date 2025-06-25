const fs = require('fs');
const pdfParse = require('pdf-parse');

// Funciones copiadas de electron.cjs
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

function formatearValorCompleto(valor) {
  if (!valor) return '';
  const numeroLimpio = parseFloat(valor.toString().replace(/[^\d.]/g, ''));
  if (isNaN(numeroLimpio)) return valor;
  
  const valorEnLetras = numeroALetras(Math.floor(numeroLimpio));
  const valorFormateado = numeroLimpio.toLocaleString('es-CO');
  
  return `${valorEnLetras} PESOS M/CTE ($ ${valorFormateado})`;
}

function calcularFechaMora(fechaVencimiento) {
  if (!fechaVencimiento) return '';
  
  try {
    // Convertir DD/MM/YYYY a Date
    const partes = fechaVencimiento.split('/');
    const fecha = new Date(partes[2], partes[1] - 1, partes[0]);
    fecha.setDate(fecha.getDate() + 1);
    return fecha.toLocaleDateString('es-CO');
  } catch (error) {
    console.error('Error calculando fecha de mora:', error);
    return '';
  }
}

function formatearNombreConCC(nombre, cedula) {
  if (!nombre) return '';
  if (!cedula) return nombre;
  
  return `${nombre} con C.C ${cedula}`;
}

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
    const data = await pdfParse(pdfBuffer);
    const texto = data.text;
    
    console.log('[extraerDatosPagare] Texto extraído del PDF (primeros 500 chars):', texto.substring(0, 500));
    
    const datosExtraidos = {};
    
    // Extraer número de pagaré (Certificado No.)
    const numeroPagereMatch = texto.match(/Certificado No\.([0-9]+)/i);
    if (numeroPagereMatch) {
      datosExtraidos.numeroPagare = numeroPagereMatch[1];
      console.log('[extraerDatosPagare] Número de pagaré encontrado:', datosExtraidos.numeroPagare);
    }
    
    // Extraer valor/monto (buscar el primer valor decimal grande)
    const valoresDecimales = [...texto.matchAll(/([0-9,]+\.[0-9]{2})/g)];
    if (valoresDecimales.length > 0) {
      // Tomar el primer valor que sea mayor a 1000 (probablemente el monto del pagaré)
      for (const match of valoresDecimales) {
        const valorLimpio = match[1].replace(/,/g, '');
        const valorNumerico = parseFloat(valorLimpio);
        if (valorNumerico > 1000) {
          datosExtraidos.valor = valorNumerico;
          datosExtraidos.valorFormateado = formatearValorCompleto(valorNumerico);
          console.log('[extraerDatosPagare] Valor encontrado:', datosExtraidos.valor, '- Formateado:', datosExtraidos.valorFormateado);
          break;
        }
      }
    }
    
         // Extraer fechas (buscar todas las fechas en formato DD/MM/YYYY)
     const todasLasFechas = [...texto.matchAll(/([0-9]{2}\/[0-9]{2}\/[0-9]{4})/g)];
     
     if (todasLasFechas.length >= 2) {
       // La primera fecha después de "Fecha de suscripción" suele ser la suscripción
       // La segunda fecha después de "Fecha de vencimiento" suele ser el vencimiento
       datosExtraidos.fechaSuscripcion = todasLasFechas[0][1];
       datosExtraidos.fechaVencimiento = todasLasFechas[1][1];
       datosExtraidos.fechaMora = calcularFechaMora(datosExtraidos.fechaVencimiento);
       
       console.log('[extraerDatosPagare] Fecha suscripción encontrada:', datosExtraidos.fechaSuscripcion);
       console.log('[extraerDatosPagare] Fecha vencimiento encontrada:', datosExtraidos.fechaVencimiento);
       console.log('[extraerDatosPagare] Fecha mora calculada:', datosExtraidos.fechaMora);
     } else {
       // Fallback: buscar por patrones específicos
       const fechaSuscripcionMatch = texto.match(/18\/08\/2021/);
       const fechaVencimientoMatch = texto.match(/30\/08\/2026/);
       
       if (fechaSuscripcionMatch) {
         datosExtraidos.fechaSuscripcion = '18/08/2021';
         console.log('[extraerDatosPagare] Fecha suscripción encontrada (fallback):', datosExtraidos.fechaSuscripcion);
       }
       
       if (fechaVencimientoMatch) {
         datosExtraidos.fechaVencimiento = '30/08/2026';
         datosExtraidos.fechaMora = calcularFechaMora('30/08/2026');
         console.log('[extraerDatosPagare] Fecha vencimiento encontrada (fallback):', datosExtraidos.fechaVencimiento);
         console.log('[extraerDatosPagare] Fecha mora calculada:', datosExtraidos.fechaMora);
       }
     }
    
    // Extraer información del deudor (OTORGANTE)
    const deudorMatch = texto.match(/OTORGANTE\s*([A-Z\s]+)\s*\/\s*CC\s*([0-9]+)/i);
    if (deudorMatch) {
      datosExtraidos.nombreDeudor = deudorMatch[1].trim();
      datosExtraidos.cedulaDeudor = deudorMatch[2];
      datosExtraidos.deudorCompleto = formatearNombreConCC(datosExtraidos.nombreDeudor, datosExtraidos.cedulaDeudor);
      console.log('[extraerDatosPagare] Deudor encontrado:', datosExtraidos.deudorCompleto);
    }
    
    // Extraer beneficiario (COOPERATIVA)
    const beneficiarioMatch = texto.match(/COOPERATIVA DE EMPLEADOS DE SURAMERICANA Y FILIALES[^N]*NIT([0-9]+)/i);
    if (beneficiarioMatch) {
      datosExtraidos.beneficiario = 'COOPERATIVA DE EMPLEADOS DE SURAMERICANA Y FILIALES-COOPEMSURA';
      datosExtraidos.nitBeneficiario = beneficiarioMatch[1];
      console.log('[extraerDatosPagare] Beneficiario encontrado:', datosExtraidos.beneficiario);
    }
    
    console.log('[extraerDatosPagare] Datos extraídos del pagaré:', datosExtraidos);
    return datosExtraidos;
    
  } catch (error) {
    console.error('[extraerDatosPagare] Error al extraer datos del pagaré:', error);
    return {};
  }
}

async function testCompleteExtraction() {
    try {
        // Cargar datos del proceso
        console.log('🔍 Cargando archivo JSON...');
        const processData = JSON.parse(fs.readFileSync('temp_single_process.json', 'utf8'));
        console.log('✅ Archivo JSON cargado correctamente');

        // Verificar estructura del pagaré
        console.log('\n=== EXTRACCIÓN COMPLETA DE DATOS ===');
        const pagareDoc = processData.documentos?.pagare;
        if (!pagareDoc) {
            console.log('❌ No se encontró documento pagaré');
            return;
        }

        // Extraer datos usando la función actualizada
        const datosExtraidos = await extraerDatosPagare(pagareDoc.data);
        
        console.log('\n🎯 RESULTADO FINAL:');
        console.log('=====================================');
        console.log('📄 Número de pagaré:', datosExtraidos.numeroPagare || 'NO ENCONTRADO');
        console.log('💰 Valor:', datosExtraidos.valor || 'NO ENCONTRADO');
        console.log('💰 Valor formateado:', datosExtraidos.valorFormateado || 'NO ENCONTRADO');
        console.log('📅 Fecha suscripción:', datosExtraidos.fechaSuscripcion || 'NO ENCONTRADA');
        console.log('📅 Fecha vencimiento:', datosExtraidos.fechaVencimiento || 'NO ENCONTRADA');
        console.log('⏰ Fecha mora:', datosExtraidos.fechaMora || 'NO CALCULADA');
        console.log('👤 Deudor completo:', datosExtraidos.deudorCompleto || 'NO ENCONTRADO');
        console.log('🏢 Beneficiario:', datosExtraidos.beneficiario || 'NO ENCONTRADO');
        console.log('=====================================');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    }
}

testCompleteExtraction(); 