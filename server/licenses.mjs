import { decryptCode, encryptCode, makeCode, normalizeCode, sha256, signPayload, verifyPayload } from "./crypto.mjs";

function validDeviceId(value) {
  const deviceId = String(value || "").trim();
  return deviceId.length >= 12 && deviceId.length <= 200 ? deviceId : null;
}

export function createLicenseService(db, config, audit) {
  const findTest = db.prepare("SELECT id,slug,name,code_prefix AS codePrefix FROM tests WHERE slug=? AND status='active'");
  const findByHash = db.prepare("SELECT l.*,t.slug AS test_slug FROM licenses l JOIN tests t ON t.id=l.test_id WHERE l.code_hash=?");
  const markRedeemed = db.prepare("UPDATE licenses SET status='redeemed',device_hash=?,redeemed_at=? WHERE id=?");
  const createBatch = db.prepare("INSERT INTO code_batches(test_id,name,prefix,total_count,created_at) VALUES(?,?,?,?,?)");
  const insertCode = db.prepare("INSERT INTO licenses(test_id,batch_id,code_hash,code_ciphertext,status,created_at) VALUES(?,?,?,?, 'available', ?)");
  const updateCipher = db.prepare("UPDATE licenses SET code_ciphertext=?,batch_id=COALESCE(batch_id,?) WHERE id=?");

  function testBySlug(slug) {
    return findTest.get(String(slug || ""));
  }

  function tokenFor(row, deviceHash) {
    return signPayload({ version: 1, licenseId: row.id, testSlug: row.test_slug, deviceHash }, config.licenseTokenSecret);
  }

  function redeem({ testSlug, code, deviceId }) {
    const test = testBySlug(testSlug);
    const cleanDeviceId = validDeviceId(deviceId);
    const normalized = normalizeCode(code);
    if (!test || !cleanDeviceId || !/^[A-Z0-9-]{8,80}$/.test(normalized)) {
      return { status: 400, body: { error: "请输入有效兑换码" } };
    }
    const row = findByHash.get(sha256(normalized));
    const deviceHash = sha256(cleanDeviceId);
    if (!row || row.test_id !== test.id) return { status: 404, body: { error: "兑换码无效或不属于本测试" } };
    if (row.status === "disabled") return { status: 410, body: { error: "兑换码已停用" } };
    if (row.device_hash && row.device_hash !== deviceHash) return { status: 409, body: { error: "兑换码已在其他设备使用" } };
    if (!row.device_hash) markRedeemed.run(deviceHash, new Date().toISOString(), row.id);
    return { status: 200, body: { authorized: true, token: tokenFor(row, deviceHash) } };
  }

  function verify({ testSlug, deviceId, token }) {
    const cleanDeviceId = validDeviceId(deviceId);
    const payload = verifyPayload(token, config.licenseTokenSecret);
    if (!cleanDeviceId) {
      return { status: 401, body: { authorized: false, error: "授权已失效，请重新输入兑换码" } };
    }
    const deviceHash = sha256(cleanDeviceId);
    if (!payload && testSlug === "moonlit-fate") {
      const legacyRow = db.prepare(`
        SELECT l.id,l.code_hash,t.slug AS test_slug
        FROM licenses l JOIN tests t ON t.id=l.test_id
        WHERE t.slug='moonlit-fate' AND l.device_hash=? AND l.status!='disabled'
        ORDER BY l.id LIMIT 1
      `).get(deviceHash);
      if (legacyRow && sha256(`${legacyRow.code_hash}:${deviceHash}:${config.legacyLicenseTokenSecret}`) === String(token || "")) {
        return { status: 200, body: { authorized: true, token: tokenFor(legacyRow, deviceHash), upgraded: true } };
      }
    }
    if (!payload || payload.testSlug !== testSlug || payload.deviceHash !== deviceHash) {
      return { status: 401, body: { authorized: false, error: "授权已失效，请重新输入兑换码" } };
    }
    const row = db.prepare("SELECT l.status,l.device_hash AS deviceHash,t.slug FROM licenses l JOIN tests t ON t.id=l.test_id WHERE l.id=?").get(payload.licenseId);
    if (!row || row.slug !== testSlug || row.status === "disabled" || row.deviceHash !== payload.deviceHash) {
      return { status: 401, body: { authorized: false, error: "授权已失效，请重新输入兑换码" } };
    }
    return { status: 200, body: { authorized: true } };
  }

  function generate({ testSlug, count, batchName, username, ipAddress }) {
    const test = testBySlug(testSlug);
    const amount = Math.min(5000, Math.max(1, Number(count) || 1));
    if (!test) throw Object.assign(new Error("测试项目不存在"), { status: 404 });
    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      const batch = createBatch.run(test.id, String(batchName || `generated-${now.slice(0, 10)}`), test.codePrefix, amount, now);
      const codes = [];
      while (codes.length < amount) {
        const code = makeCode(test.codePrefix);
        try {
          insertCode.run(test.id, Number(batch.lastInsertRowid), sha256(code), encryptCode(code, config.codeEncryptionKey), now);
          codes.push(code);
        } catch (error) {
          if (!String(error.message).includes("UNIQUE")) throw error;
        }
      }
      return { batchId: Number(batch.lastInsertRowid), codes };
    });
    const result = transaction();
    audit.record({ username, action: "licenses.generate", objectType: "batch", objectId: result.batchId, detail: { testSlug, count: amount, batchName }, ipAddress });
    return result;
  }

  function importCodes({ testSlug, codes, batchName, username, ipAddress }) {
    const test = testBySlug(testSlug);
    if (!test) throw Object.assign(new Error("测试项目不存在"), { status: 404 });
    const normalizedCodes = [...new Set((Array.isArray(codes) ? codes : String(codes || "").split(/\r?\n/)).map(normalizeCode).filter(Boolean))];
    if (!normalizedCodes.length || normalizedCodes.length > 10000) throw Object.assign(new Error("请输入 1 到 10000 个兑换码"), { status: 400 });
    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      const batch = createBatch.run(test.id, String(batchName || `import-${now.slice(0, 10)}`), test.codePrefix, normalizedCodes.length, now);
      let added = 0;
      let completed = 0;
      let duplicate = 0;
      let invalid = 0;
      for (const code of normalizedCodes) {
        if (!/^[A-Z0-9-]{8,80}$/.test(code)) { invalid += 1; continue; }
        const codeHash = sha256(code);
        const existing = findByHash.get(codeHash);
        if (existing) {
          if (existing.test_id !== test.id) { duplicate += 1; continue; }
          if (!existing.code_ciphertext) {
            updateCipher.run(encryptCode(code, config.codeEncryptionKey), Number(batch.lastInsertRowid), existing.id);
            completed += 1;
          } else duplicate += 1;
          continue;
        }
        insertCode.run(test.id, Number(batch.lastInsertRowid), codeHash, encryptCode(code, config.codeEncryptionKey), now);
        added += 1;
      }
      db.prepare("UPDATE code_batches SET total_count=? WHERE id=?").run(added + completed, Number(batch.lastInsertRowid));
      return { batchId: Number(batch.lastInsertRowid), added, completed, duplicate, invalid, total: normalizedCodes.length };
    });
    const result = transaction();
    audit.record({ username, action: "licenses.import", objectType: "batch", objectId: result.batchId, detail: { testSlug, ...result }, ipAddress });
    return result;
  }

  const allocateTransaction = db.transaction(({ test, orderRef }) => {
    const existing = db.prepare("SELECT * FROM licenses WHERE test_id=? AND order_ref=?").get(test.id, orderRef);
    if (existing) return { row: existing, repeated: true };
    const row = db.prepare("SELECT * FROM licenses WHERE test_id=? AND status='available' AND code_ciphertext IS NOT NULL ORDER BY id LIMIT 1").get(test.id);
    if (!row) throw Object.assign(new Error("当前测试没有可发放的兑换码"), { status: 409 });
    const now = new Date().toISOString();
    const changed = db.prepare("UPDATE licenses SET status='allocated',order_ref=?,allocated_at=? WHERE id=? AND status='available'").run(orderRef, now, row.id);
    if (changed.changes !== 1) throw Object.assign(new Error("兑换码分配冲突，请重试"), { status: 409 });
    return { row: { ...row, status: "allocated", order_ref: orderRef, allocated_at: now }, repeated: false };
  });

  function allocate({ testSlug, orderRef, username, ipAddress }) {
    const test = testBySlug(testSlug);
    const cleanOrderRef = String(orderRef || "").trim();
    if (!test) throw Object.assign(new Error("测试项目不存在"), { status: 404 });
    if (cleanOrderRef.length < 2 || cleanOrderRef.length > 100) throw Object.assign(new Error("请输入有效订单号或买家标识"), { status: 400 });
    const result = allocateTransaction({ test, orderRef: cleanOrderRef });
    const code = decryptCode(result.row.code_ciphertext, config.codeEncryptionKey);
    audit.record({ username, action: result.repeated ? "licenses.allocate_repeat" : "licenses.allocate", objectType: "license", objectId: result.row.id, detail: { testSlug, orderRef: cleanOrderRef }, ipAddress });
    return { id: result.row.id, code, orderRef: cleanOrderRef, repeated: result.repeated, testName: test.name };
  }

  function list({ testSlug, query, status, limit = 100 }) {
    const where = [];
    const params = [];
    if (testSlug) { where.push("t.slug=?"); params.push(testSlug); }
    if (status) { where.push("l.status=?"); params.push(status); }
    if (query) {
      const normalized = normalizeCode(query);
      where.push("(l.order_ref LIKE ? OR l.code_hash=?)");
      params.push(`%${String(query).trim()}%`, sha256(normalized));
    }
    params.push(Math.min(500, Math.max(1, Number(limit) || 100)));
    return db.prepare(`
      SELECT l.id,t.slug AS testSlug,t.name AS testName,b.name AS batchName,l.status,l.order_ref AS orderRef,
             l.device_hash AS deviceHash,l.created_at AS createdAt,l.allocated_at AS allocatedAt,
             l.redeemed_at AS redeemedAt,l.disabled_at AS disabledAt,l.code_ciphertext AS ciphertext
      FROM licenses l JOIN tests t ON t.id=l.test_id LEFT JOIN code_batches b ON b.id=l.batch_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY l.id DESC LIMIT ?
    `).all(...params).map((row) => ({
      ...row,
      codeMasked: row.ciphertext ? `${decryptCode(row.ciphertext, config.codeEncryptionKey).slice(0, 5)}-****-****-****` : "仅摘要",
      ciphertext: undefined,
      deviceBound: Boolean(row.deviceHash),
      deviceHash: undefined,
    }));
  }

  function action({ id, action, username, ipAddress }) {
    const license = db.prepare("SELECT id,status FROM licenses WHERE id=?").get(Number(id));
    if (!license) throw Object.assign(new Error("兑换码不存在"), { status: 404 });
    const now = new Date().toISOString();
    if (action === "disable") db.prepare("UPDATE licenses SET status='disabled',disabled_at=? WHERE id=?").run(now, license.id);
    else if (action === "enable") db.prepare("UPDATE licenses SET status=CASE WHEN device_hash IS NULL THEN CASE WHEN order_ref IS NULL THEN 'available' ELSE 'allocated' END ELSE 'redeemed' END,disabled_at=NULL WHERE id=?").run(license.id);
    else if (action === "unbind") db.prepare("UPDATE licenses SET device_hash=NULL,redeemed_at=NULL,status=CASE WHEN order_ref IS NULL THEN 'available' ELSE 'allocated' END WHERE id=?").run(license.id);
    else throw Object.assign(new Error("不支持的操作"), { status: 400 });
    audit.record({ username, action: `licenses.${action}`, objectType: "license", objectId: license.id, ipAddress });
    return { ok: true };
  }

  function exportBatch(batchId, username, ipAddress) {
    const batch = db.prepare("SELECT b.id,b.name,t.slug AS testSlug FROM code_batches b JOIN tests t ON t.id=b.test_id WHERE b.id=?").get(Number(batchId));
    if (!batch) throw Object.assign(new Error("批次不存在"), { status: 404 });
    const rows = db.prepare("SELECT code_ciphertext AS ciphertext FROM licenses WHERE batch_id=? AND code_ciphertext IS NOT NULL ORDER BY id").all(batch.id);
    audit.record({ username, action: "licenses.export", objectType: "batch", objectId: batch.id, detail: { count: rows.length }, ipAddress });
    return { filename: `${batch.testSlug}-${batch.name}.txt`.replace(/[^a-zA-Z0-9._-]+/g, "-"), text: rows.map((row) => decryptCode(row.ciphertext, config.codeEncryptionKey)).join("\n") + "\n" };
  }

  return { redeem, verify, generate, importCodes, allocate, list, action, exportBatch };
}
