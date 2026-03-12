/**
 * 낙관적 잠금 미들웨어
 * PUT/PATCH 요청 시 body.version과 DB version을 비교하여 충돌 감지
 */

/**
 * 낙관적 잠금 UPDATE 헬퍼
 * @param {object} client — DB client or pool
 * @param {string} table — 테이블명
 * @param {string} idCol — PK 컬럼명
 * @param {string} idVal — PK 값
 * @param {number} clientVersion — 클라이언트가 보낸 version
 * @param {object} updates — { col: val } 업데이트할 컬럼들
 * @param {string} [updatedBy] — 수정한 사용자 ID
 * @returns {object} { success, row, conflict }
 */
async function optimisticUpdate(client, table, idCol, idVal, clientVersion, updates, updatedBy) {
  // version이 없으면 잠금 없이 진행 (하위호환)
  if (clientVersion === undefined || clientVersion === null) {
    var cols = Object.keys(updates);
    var vals = cols.map(function (c) { return updates[c]; });
    var setClause = cols.map(function (c, i) { return c + ' = $' + (i + 1); }).join(', ');
    setClause += ', version = version + 1, updated_at = now()';
    if (updatedBy) {
      setClause += ', updated_by = $' + (vals.length + 1);
      vals.push(updatedBy);
    }
    vals.push(idVal);
    var sql = 'UPDATE ' + table + ' SET ' + setClause + ' WHERE ' + idCol + ' = $' + vals.length + ' RETURNING *';
    var res = await client.query(sql, vals);
    return { success: res.rows.length > 0, row: res.rows[0] || null, conflict: false };
  }

  // 낙관적 잠금 적용
  var cols2 = Object.keys(updates);
  var vals2 = cols2.map(function (c) { return updates[c]; });
  var setClause2 = cols2.map(function (c, i) { return c + ' = $' + (i + 1); }).join(', ');
  setClause2 += ', version = version + 1, updated_at = now()';
  if (updatedBy) {
    setClause2 += ', updated_by = $' + (vals2.length + 1);
    vals2.push(updatedBy);
  }
  vals2.push(idVal);
  vals2.push(clientVersion);

  var sql2 = 'UPDATE ' + table + ' SET ' + setClause2 + ' WHERE ' + idCol + ' = $' + (vals2.length - 1) + ' AND version = $' + vals2.length + ' RETURNING *';
  var res2 = await client.query(sql2, vals2);

  if (res2.rows.length > 0) {
    return { success: true, row: res2.rows[0], conflict: false };
  }

  // version 불일치 → 최신 데이터 조회
  var latestRes = await client.query('SELECT * FROM ' + table + ' WHERE ' + idCol + ' = $1', [idVal]);
  var latest = latestRes.rows[0] || null;

  if (!latest) {
    return { success: false, row: null, conflict: false };
  }

  return { success: false, row: null, conflict: true, latest: latest, yourVersion: clientVersion };
}

/**
 * 409 Conflict 응답 전송 헬퍼
 */
function sendConflict(res, latest, yourVersion) {
  return res.status(409).json({
    error: 'CONFLICT',
    message: '다른 사용자가 이미 수정했습니다.',
    latest: latest,
    yourVersion: yourVersion
  });
}

module.exports = {
  optimisticUpdate: optimisticUpdate,
  sendConflict: sendConflict
};
