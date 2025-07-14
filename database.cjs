// database.cjs - Módulo de base de datos SQLite para StaffBot
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class StaffBotDatabase {
  constructor() {
    this.db = null;
    this.init();
  }

  init() {
    try {
      // Crear el directorio de base de datos si no existe
      const dbDir = path.join(app.getPath('userData'), '..', 'Electron');
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Crear conexión a la base de datos
      const dbPath = path.join(dbDir, 'staffbot.db');
      this.db = new Database(dbPath);
      
      // Configurar la base de datos
      this.db.pragma('journal_mode = WAL'); // Mejora el rendimiento
      this.db.pragma('synchronous = NORMAL'); // Balance entre rendimiento y seguridad
      this.db.pragma('cache_size = 1000'); // Cache de 1000 páginas
      this.db.pragma('temp_store = memory'); // Usar memoria para temporales
      
      // Crear las tablas
      this.createTables();
      
      console.log(`[Database] Base de datos inicializada en: ${dbPath}`);
    } catch (error) {
      console.error('[Database] Error al inicializar la base de datos:', error);
    }
  }

  createTables() {
    // Tabla principal de procesos
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS procesos (
        id INTEGER PRIMARY KEY,
        proceso_id TEXT UNIQUE NOT NULL,
        cliente_razon TEXT,
        cliente_nit TEXT,
        cliente_ciudad TEXT,
        cliente_direccion TEXT,
        cliente_telefono TEXT,
        cliente_email TEXT,
        demandado_nombre TEXT,
        demandado_cedula TEXT,
        demandado_ciudad TEXT,
        demandado_direccion TEXT,
        demandado_telefono TEXT,
        demandado_email TEXT,
        pagare_numero TEXT,
        pagare_valor REAL,
        pagare_valor_formateado TEXT,
        pagare_fecha_suscripcion TEXT,
        pagare_fecha_vencimiento TEXT,
        pagare_fecha_mora TEXT,
        data_json TEXT NOT NULL, -- JSON completo para compatibilidad
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de datos mapeados editados
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mapped_data (
        id INTEGER PRIMARY KEY,
        proceso_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(proceso_id, field_name),
        FOREIGN KEY (proceso_id) REFERENCES procesos(proceso_id) ON DELETE CASCADE
      )
    `);

    // Tabla de cache de documentos generados
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_cache (
        id INTEGER PRIMARY KEY,
        proceso_id TEXT NOT NULL,
        document_type TEXT NOT NULL, -- 'demanda', 'portada', etc.
        file_path TEXT NOT NULL,
        generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (proceso_id) REFERENCES procesos(proceso_id) ON DELETE CASCADE
      )
    `);

    // Índices para mejorar el rendimiento
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_procesos_cliente_razon ON procesos(cliente_razon);
      CREATE INDEX IF NOT EXISTS idx_procesos_demandado_nombre ON procesos(demandado_nombre);
      CREATE INDEX IF NOT EXISTS idx_procesos_created_at ON procesos(created_at);
      CREATE INDEX IF NOT EXISTS idx_mapped_data_proceso_id ON mapped_data(proceso_id);
      CREATE INDEX IF NOT EXISTS idx_document_cache_proceso_id ON document_cache(proceso_id);
    `);

    // Trigger para actualizar updated_at automáticamente
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_procesos_timestamp 
      AFTER UPDATE ON procesos
      BEGIN
        UPDATE procesos SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_mapped_data_timestamp 
      AFTER UPDATE ON mapped_data
      BEGIN
        UPDATE mapped_data SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `);

    console.log('[Database] Tablas creadas exitosamente');
  }

  // ========== MÉTODOS PARA PROCESOS ==========

  // Insertar o actualizar múltiples procesos (desde la API)
  upsertProcesses(processes) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO procesos (
        proceso_id, cliente_razon, cliente_nit, cliente_ciudad, cliente_direccion,
        cliente_telefono, cliente_email, demandado_nombre, demandado_cedula,
        demandado_ciudad, demandado_direccion, demandado_telefono, demandado_email,
        pagare_numero, pagare_valor, pagare_valor_formateado, pagare_fecha_suscripcion,
        pagare_fecha_vencimiento, pagare_fecha_mora, data_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      for (const process of processes) {
        stmt.run(
          process.proceso_id,
          process.cliente?.razon || null,
          process.cliente?.nit || null,
          process.cliente?.ciudad || null,
          process.cliente?.direccion || null,
          process.cliente?.telefono || null,
          process.cliente?.email || null,
          process.demandado?.nombre || null,
          process.demandado?.cedula || null,
          process.demandado?.ciudad || null,
          process.demandado?.direccion || null,
          process.demandado?.telefono || null,
          process.demandado?.email || null,
          process.pagare?.numero || null,
          process.pagare?.valor || null,
          process.pagare?.valor_formateado || null,
          process.pagare?.fecha_suscripcion || null,
          process.pagare?.fecha_vencimiento || null,
          process.pagare?.fecha_mora || null,
          JSON.stringify(process) // Almacenar JSON completo
        );
      }
    });

    try {
      transaction();
      console.log(`[Database] ${processes.length} procesos insertados/actualizados`);
      return { success: true, count: processes.length };
    } catch (error) {
      console.error('[Database] Error al insertar procesos:', error);
      return { success: false, error: error.message };
    }
  }

  // Obtener todos los procesos
  getAllProcesses() {
    try {
      const stmt = this.db.prepare(`
        SELECT data_json, created_at, updated_at
        FROM procesos 
        ORDER BY created_at DESC
      `);
      
      const rows = stmt.all();
      const processes = rows.map(row => ({
        ...JSON.parse(row.data_json),
        _db_created_at: row.created_at,
        _db_updated_at: row.updated_at
      }));
      
      console.log(`[Database] Obtenidos ${processes.length} procesos`);
      return processes;
    } catch (error) {
      console.error('[Database] Error al obtener procesos:', error);
      return [];
    }
  }

  // Obtener un proceso específico
  getProcess(proceso_id) {
    try {
      const stmt = this.db.prepare(`
        SELECT data_json, created_at, updated_at
        FROM procesos 
        WHERE proceso_id = ?
      `);
      
      const row = stmt.get(proceso_id);
      if (row) {
        return {
          ...JSON.parse(row.data_json),
          _db_created_at: row.created_at,
          _db_updated_at: row.updated_at
        };
      }
      return null;
    } catch (error) {
      console.error('[Database] Error al obtener proceso:', error);
      return null;
    }
  }

  // Buscar procesos por cliente
  searchProcessesByClient(clientName) {
    try {
      const stmt = this.db.prepare(`
        SELECT data_json, created_at, updated_at
        FROM procesos 
        WHERE cliente_razon LIKE ? 
        ORDER BY created_at DESC
      `);
      
      const rows = stmt.all(`%${clientName}%`);
      const processes = rows.map(row => ({
        ...JSON.parse(row.data_json),
        _db_created_at: row.created_at,
        _db_updated_at: row.updated_at
      }));
      
      return processes;
    } catch (error) {
      console.error('[Database] Error al buscar procesos por cliente:', error);
      return [];
    }
  }

  // Eliminar procesos por IDs
  deleteProcesses(procesoIds) {
    try {
      const placeholders = procesoIds.map(() => '?').join(', ');
      const stmt = this.db.prepare(`DELETE FROM procesos WHERE proceso_id IN (${placeholders})`);
      
      const result = stmt.run(...procesoIds);
      console.log(`[Database] Eliminados ${result.changes} procesos de la base de datos`);
      
      return { success: true, deletedCount: result.changes };
    } catch (error) {
      console.error('[Database] Error al eliminar procesos:', error);
      return { success: false, error: error.message, deletedCount: 0 };
    }
  }

  // ========== MÉTODOS PARA MAPPED DATA ==========

  // Guardar datos de campos editados
  updateMappedData(proceso_id, mappedData) {
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO mapped_data (proceso_id, field_name, field_value)
      VALUES (?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      for (const [fieldName, fieldValue] of Object.entries(mappedData)) {
        insertStmt.run(proceso_id, fieldName, fieldValue);
      }
    });

    try {
      transaction();
      console.log(`[Database] Datos mapeados actualizados para proceso ${proceso_id}`);
      return { success: true };
    } catch (error) {
      console.error('[Database] Error al actualizar mapped data:', error);
      return { success: false, error: error.message };
    }
  }

  // Obtener datos de campos editados
  getMappedData(proceso_id) {
    try {
      const stmt = this.db.prepare(`
        SELECT field_name, field_value
        FROM mapped_data 
        WHERE proceso_id = ?
      `);
      
      const rows = stmt.all(proceso_id);
      const mappedData = {};
      
      for (const row of rows) {
        mappedData[row.field_name] = row.field_value;
      }
      
      console.log(`[Database] Obtenidos ${Object.keys(mappedData).length} campos mapeados para proceso ${proceso_id}`);
      return mappedData;
    } catch (error) {
      console.error('[Database] Error al obtener mapped data:', error);
      return {};
    }
  }

  // Eliminar datos de campos editados
  deleteMappedData(proceso_id) {
    try {
      const stmt = this.db.prepare(`DELETE FROM mapped_data WHERE proceso_id = ?`);
      const result = stmt.run(proceso_id);
      
      console.log(`[Database] Eliminados ${result.changes} campos mapeados para proceso ${proceso_id}`);
      return { success: true, deleted: result.changes };
    } catch (error) {
      console.error('[Database] Error al eliminar mapped data:', error);
      return { success: false, error: error.message };
    }
  }

  // ========== MÉTODOS PARA DOCUMENT CACHE ==========

  // Guardar referencia de documento generado
  saveDocumentCache(proceso_id, documentType, filePath) {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO document_cache (proceso_id, document_type, file_path)
        VALUES (?, ?, ?)
      `);
      
      stmt.run(proceso_id, documentType, filePath);
      console.log(`[Database] Cache de documento guardado: ${documentType} para proceso ${proceso_id}`);
      return { success: true };
    } catch (error) {
      console.error('[Database] Error al guardar cache de documento:', error);
      return { success: false, error: error.message };
    }
  }

  // Obtener caché de documentos
  getDocumentCache(proceso_id, documentType = null) {
    try {
      let stmt;
      let params;
      
      if (documentType) {
        stmt = this.db.prepare(`
          SELECT document_type, file_path, generated_at
          FROM document_cache 
          WHERE proceso_id = ? AND document_type = ?
          ORDER BY generated_at DESC
        `);
        params = [proceso_id, documentType];
      } else {
        stmt = this.db.prepare(`
          SELECT document_type, file_path, generated_at
          FROM document_cache 
          WHERE proceso_id = ?
          ORDER BY generated_at DESC
        `);
        params = [proceso_id];
      }
      
      const rows = stmt.all(...params);
      return rows;
    } catch (error) {
      console.error('[Database] Error al obtener cache de documentos:', error);
      return [];
    }
  }

  // ========== MÉTODOS DE MANTENIMIENTO ==========

  // Obtener estadísticas de la base de datos
  getStats() {
    try {
      const procesosCount = this.db.prepare('SELECT COUNT(*) as count FROM procesos').get().count;
      const mappedDataCount = this.db.prepare('SELECT COUNT(*) as count FROM mapped_data').get().count;
      const documentCacheCount = this.db.prepare('SELECT COUNT(*) as count FROM document_cache').get().count;
      
      const dbSize = this.db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get().size;
      
      return {
        procesos: procesosCount,
        mappedData: mappedDataCount,
        documentCache: documentCacheCount,
        dbSizeBytes: dbSize,
        dbSizeMB: Math.round(dbSize / (1024 * 1024) * 100) / 100
      };
    } catch (error) {
      console.error('[Database] Error al obtener estadísticas:', error);
      return null;
    }
  }

  // Limpiar datos antiguos
  cleanup(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      
      const stmt = this.db.prepare(`
        DELETE FROM document_cache 
        WHERE generated_at < ?
      `);
      
      const result = stmt.run(cutoffDate.toISOString());
      console.log(`[Database] Limpieza completada: ${result.changes} documentos en cache eliminados`);
      return { success: true, deleted: result.changes };
    } catch (error) {
      console.error('[Database] Error en limpieza:', error);
      return { success: false, error: error.message };
    }
  }

  // Cerrar conexión
  close() {
    if (this.db) {
      this.db.close();
      console.log('[Database] Conexión cerrada');
    }
  }
}

// Singleton para la base de datos
let dbInstance = null;

function getDatabase() {
  if (!dbInstance) {
    dbInstance = new StaffBotDatabase();
  }
  return dbInstance;
}

module.exports = {
  getDatabase,
  StaffBotDatabase
}; 