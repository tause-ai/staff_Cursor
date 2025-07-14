// migrate_to_sqlite.cjs - Script para migrar datos del JSON a SQLite
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

// Simular app.getPath para el script
if (!app.getPath) {
  app.getPath = (name) => {
    if (name === 'userData') {
      return path.join(require('os').homedir(), 'Library', 'Application Support');
    }
    return '/tmp';
  };
}

const { getDatabase } = require('./database.cjs');

async function migrateFromJSON() {
  console.log('🔄 Iniciando migración de datos JSON a SQLite...');
  
  try {
    // Obtener la base de datos
    const db = getDatabase();
    
    // Ruta del archivo JSON existente
    const jsonPath = path.join(app.getPath('userData'), '..', 'Electron', 'procesos_del_dia.json');
    
    // Verificar si el archivo JSON existe
    try {
      await fs.access(jsonPath);
      console.log(`📁 Archivo JSON encontrado en: ${jsonPath}`);
    } catch (error) {
      console.log('⚠️  No se encontró archivo JSON existente. Creando base de datos limpia...');
      return { success: true, message: 'Base de datos inicializada sin datos previos' };
    }
    
    // Leer el archivo JSON
    const jsonData = await fs.readFile(jsonPath, 'utf-8');
    const processes = JSON.parse(jsonData);
    
    console.log(`📊 Encontrados ${processes.length} procesos en JSON`);
    
    // Migrar procesos principales
    const result = db.upsertProcesses(processes);
    
    if (result.success) {
      console.log(`✅ ${result.count} procesos migrados exitosamente`);
    } else {
      console.error('❌ Error al migrar procesos:', result.error);
      return { success: false, error: result.error };
    }
    
    // Migrar datos de mapped_data si existen
    const cacheDir = path.join(app.getPath('userData'), '..', 'Electron', 'process_cache');
    
    try {
      await fs.access(cacheDir);
      console.log(`📁 Directorio de cache encontrado: ${cacheDir}`);
      
      const cacheFiles = await fs.readdir(cacheDir);
      let migratedMappedData = 0;
      
      for (const file of cacheFiles) {
        if (file.endsWith('_mappedData.json')) {
          const match = file.match(/process_(.+)_mappedData\.json/);
          if (match) {
            const procesoId = match[1];
            const filePath = path.join(cacheDir, file);
            
            try {
              const mappedDataJSON = await fs.readFile(filePath, 'utf-8');
              const mappedData = JSON.parse(mappedDataJSON);
              
              const updateResult = db.updateMappedData(procesoId, mappedData);
              if (updateResult.success) {
                migratedMappedData++;
              }
            } catch (error) {
              console.warn(`⚠️  Error al migrar mapped data para proceso ${procesoId}:`, error.message);
            }
          }
        }
      }
      
      console.log(`✅ ${migratedMappedData} archivos de mapped data migrados`);
    } catch (error) {
      console.log('⚠️  No se encontró directorio de cache o está vacío');
    }
    
    // Crear backup del archivo JSON original
    const backupPath = `${jsonPath}.backup_${Date.now()}`;
    await fs.copyFile(jsonPath, backupPath);
    console.log(`💾 Backup creado en: ${backupPath}`);
    
    // Mostrar estadísticas finales
    const stats = db.getStats();
    console.log('\n📊 Estadísticas finales de la base de datos:');
    console.log(`   - Procesos: ${stats.procesos}`);
    console.log(`   - Datos mapeados: ${stats.mappedData}`);
    console.log(`   - Cache documentos: ${stats.documentCache}`);
    console.log(`   - Tamaño BD: ${stats.dbSizeMB} MB`);
    
    return { 
      success: true, 
      message: `Migración completada: ${stats.procesos} procesos, ${stats.mappedData} campos mapeados`,
      stats 
    };
    
  } catch (error) {
    console.error('❌ Error durante la migración:', error);
    return { success: false, error: error.message };
  }
}

// Función para validar la migración
async function validateMigration() {
  console.log('\n🔍 Validando migración...');
  
  try {
    const db = getDatabase();
    
    // Verificar que los datos estén en la base de datos
    const processes = db.getAllProcesses();
    console.log(`✅ Validación: ${processes.length} procesos encontrados en la base de datos`);
    
    // Verificar algunos procesos aleatorios
    if (processes.length > 0) {
      const randomProcess = processes[Math.floor(Math.random() * processes.length)];
      console.log(`🔍 Proceso de ejemplo: ${randomProcess.proceso_id} - ${randomProcess.cliente?.razon || 'Sin cliente'}`);
      
      // Verificar mapped data si existe
      const mappedData = db.getMappedData(randomProcess.proceso_id);
      if (Object.keys(mappedData).length > 0) {
        console.log(`✅ Mapped data encontrado para proceso ${randomProcess.proceso_id}: ${Object.keys(mappedData).length} campos`);
      }
    }
    
    return { success: true, processCount: processes.length };
  } catch (error) {
    console.error('❌ Error en validación:', error);
    return { success: false, error: error.message };
  }
}

// Ejecutar migración si el script se ejecuta directamente
if (require.main === module) {
  (async () => {
    const result = await migrateFromJSON();
    if (result.success) {
      await validateMigration();
      console.log('\n🎉 Migración completada exitosamente!');
    } else {
      console.error('\n❌ Migración falló:', result.error);
      process.exit(1);
    }
  })();
}

module.exports = {
  migrateFromJSON,
  validateMigration
}; 