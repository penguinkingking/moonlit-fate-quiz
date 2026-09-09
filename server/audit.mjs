export function createAuditService(db) {
  const insert = db.prepare(`
    INSERT INTO audit_logs(username,action,object_type,object_id,detail_json,ip_address,created_at)
    VALUES(?,?,?,?,?,?,?)
  `);
  return {
    record({ username, action, objectType = null, objectId = null, detail = {}, ipAddress = null }) {
      insert.run(username, action, objectType, objectId == null ? null : String(objectId), JSON.stringify(detail), ipAddress, new Date().toISOString());
    },
    list(limit = 100) {
      return db.prepare("SELECT id,username,action,object_type AS objectType,object_id AS objectId,detail_json AS detailJson,ip_address AS ipAddress,created_at AS createdAt FROM audit_logs ORDER BY id DESC LIMIT ?")
        .all(Math.min(500, Math.max(1, Number(limit) || 100)))
        .map((row) => ({ ...row, detail: JSON.parse(row.detailJson || "{}"), detailJson: undefined }));
    },
  };
}
