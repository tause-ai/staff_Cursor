const Pizzip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fs = require('fs');
const path = require('path');

// Corregimos la ruta de importación y el nombre del módulo
const InspectModule = require('docxtemplater/js/inspect-module.js');

// Obtener la ruta del archivo desde los argumentos de la línea de comandos
// o usar un archivo por defecto para las pruebas.
const defaultFile = path.join('formatos', 'formatos', 'FORMATO BANCAMIA NORMAL.docx');
const filePath = process.argv[2] || defaultFile;

if (!fs.existsSync(filePath)) {
    console.error(`Error: El archivo no se encuentra en la ruta especificada: ${filePath}`);
  process.exit(1);
}

console.log(`Inspeccionando la plantilla: ${filePath}`);

try {
    const content = fs.readFileSync(filePath); // 'binary' está obsoleto, Buffer es mejor
    const zip = new Pizzip(content);
  
    // Con la v4, el módulo se instancia y se pasa en el constructor
    const iModule = InspectModule();
    const doc = new Docxtemplater(zip, {
        delimiters: {
            start: '«',
            end: '»'
        },
        paragraphsLoop: true,
        linebreaks: true,
        modules: [iModule]
    });
  
    // Es necesario hacer un render (aunque sea con datos vacíos) para que el inspector se ejecute
  doc.render();
  
    const tags = iModule.getAllTags();

    if (Object.keys(tags).length > 0) {
        console.log('Se encontraron los siguientes placeholders en el documento:');
        // Imprimimos los nombres de los placeholders encontrados
        console.log(Object.keys(tags));
    } else {
        console.log('No se encontraron placeholders con el formato {{placeholder}} en el documento.');
    }

} catch (error) {
    // Manejo de errores que pueden ocurrir si el archivo no es un docx válido
    // o está corrupto.
    if (error.properties && error.properties.id === 'file_corrupted') {
        console.error('Error: El archivo parece estar corrupto o no es un formato DOCX válido.');
        console.error(error.message);
  } else {
        console.error('Ocurrió un error inesperado al procesar el archivo:', error);
  }
} 
