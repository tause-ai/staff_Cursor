const fs = require('fs');
const pdfParse = require('pdf-parse');

async function testPdfExtraction() {
    try {
        // Cargar datos del proceso
        console.log('🔍 Cargando archivo JSON...');
        const processData = JSON.parse(fs.readFileSync('temp_single_process.json', 'utf8'));
        console.log('✅ Archivo JSON cargado correctamente');

        // Verificar estructura del pagaré
        console.log('\n=== ESTRUCTURA DEL PAGARÉ ===');
        const pagareDoc = processData.documentos?.pagare;
        if (!pagareDoc) {
            console.log('❌ No se encontró documento pagaré');
            return;
        }

        console.log('Nombre archivo:', pagareDoc.filename);
        console.log('Tipo contenido:', pagareDoc.content_type);
        console.log('Tiene base64:', !!pagareDoc.data);
        console.log('Longitud base64:', pagareDoc.data?.length || 0);

        if (!pagareDoc.data) {
            console.log('❌ No hay datos base64 en el pagaré');
            return;
        }

        // Convertir base64 a buffer
        console.log('\n🔄 Convirtiendo base64 a buffer...');
        const pdfBuffer = Buffer.from(pagareDoc.data, 'base64');
        console.log('✅ Buffer PDF creado, tamaño:', pdfBuffer.length, 'bytes');

        // Extraer texto del PDF
        console.log('\n📄 Extrayendo texto del PDF...');
        const data = await pdfParse(pdfBuffer);
        console.log('✅ PDF procesado exitosamente');
        console.log('Número de páginas:', data.numpages);
        console.log('Longitud del texto:', data.text.length);
        
        console.log('\n=== CONTENIDO DEL PDF (primeros 2000 caracteres) ===');
        console.log(data.text.substring(0, 2000));
        
        console.log('\n=== EXTRACCIÓN DE DATOS ESPECÍFICOS ===');
        
        // Buscar valor del pagaré con mejor regex
        console.log('💰 VALORES:');
        
        // Regex específico para el monto total
        const montoMatch = data.text.match(/Monto total del pagaré\s*[\s\S]*?([0-9,]+\.?[0-9]*)/i);
        console.log('  Monto total del pagaré:', montoMatch ? montoMatch[1] : 'No encontrado');
        
        // Todos los valores con $
        const valoresDolar = [...data.text.matchAll(/\$\s*([0-9,]+(?:\.[0-9]{2})?)/g)];
        console.log('  Valores con $:', valoresDolar.map(m => m[1]));
        
        // Todos los números decimales
        const valoresDecimales = [...data.text.matchAll(/([0-9,]+\.[0-9]{2})/g)];
        console.log('  Valores decimales:', valoresDecimales.map(m => m[0]));
        
        // Buscar fechas específicas
        console.log('\n📅 FECHAS:');
        const fechaSuscripcion = data.text.match(/Fecha de suscripción\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i);
        const fechaVencimiento = data.text.match(/Fecha de vencimiento.*?([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i);
        
        console.log('  Suscripción:', fechaSuscripcion ? fechaSuscripcion[1] : 'No encontrada');
        console.log('  Vencimiento:', fechaVencimiento ? fechaVencimiento[1] : 'No encontrada');
        
        // Buscar número de pagaré
        console.log('\n🔢 NÚMERO DE PAGARÉ:');
        const numeroRegexes = [
            /Certificado No\.([0-9]+)/i,
            /No\.\s*([0-9]+)/i,
            /identificado en Deceval con No\.\s*([0-9]+)/i
        ];
        
        numeroRegexes.forEach((regex, i) => {
            const match = data.text.match(regex);
            console.log(`  Regex ${i+1}:`, match ? match[1] : 'No encontrado');
        });
        
        // Buscar beneficiario/deudor
        console.log('\n👤 INFORMACIÓN DE PERSONAS:');
        const beneficiarioMatch = data.text.match(/BENEFICIARIO\(OS\)\s*[\s\S]*?([A-Z\s]+)/i);
        console.log('  Beneficiario:', beneficiarioMatch ? beneficiarioMatch[1].trim() : 'No encontrado');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    }
}

testPdfExtraction(); 