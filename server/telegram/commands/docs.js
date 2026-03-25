/**
 * 문서 명령어 모듈: /docs, /search-doc
 */
var db = require('../../config/db');

function create(sendMessage) {
  /** 봇 명령어: /docs — 문서 목록 */
  async function cmdDocs(chatId, user, query) {
    var docsR;
    if (!query) {
      docsR = await db.query(
        'SELECT pf.name, pf.ext, pf.size, pf.created_at, p.name as project_name FROM project_files pf LEFT JOIN projects p ON p.id = pf.project_id ORDER BY pf.created_at DESC LIMIT 10'
      );
    } else {
      docsR = await db.query(
        'SELECT pf.name, pf.ext, pf.size, pf.created_at, p.name as project_name FROM project_files pf LEFT JOIN projects p ON p.id = pf.project_id WHERE p.name ILIKE $1 OR pf.name ILIKE $1 ORDER BY pf.created_at DESC LIMIT 10',
        ['%' + query + '%']
      );
    }

    if (docsR.rows.length === 0) {
      return sendMessage(chatId, '📁 문서가 없습니다.' + (query ? ' (검색: ' + query + ')' : ''));
    }

    var msg = '📁 <b>문서 목록</b>' + (query ? ' — ' + query : '') + '\n\n';
    docsR.rows.forEach(function (r, i) {
      var sizeStr = '';
      if (r.size) {
        var sizeKB = r.size / 1024;
        sizeStr = sizeKB >= 1024 ? (Math.round(sizeKB / 1024 * 10) / 10) + 'MB' : Math.round(sizeKB) + 'KB';
      }
      var dateStr = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '';
      msg += (i + 1) + '. ' + r.name + (r.ext ? '.' + r.ext : '');
      if (sizeStr) msg += ' (' + sizeStr + ')';
      if (dateStr) msg += ' ' + dateStr;
      if (r.project_name) msg += '\n   📁 ' + r.project_name;
      msg += '\n';
    });

    return sendMessage(chatId, msg);
  }

  /** 봇 명령어: /search-doc — 문서 검색 */
  async function cmdSearchDoc(chatId, user, query) {
    if (!query) {
      return sendMessage(chatId, '사용법: /search-doc <키워드>');
    }

    var docsR = await db.query(
      'SELECT pf.name, pf.ext, pf.size, pf.created_at, p.name as project_name FROM project_files pf LEFT JOIN projects p ON p.id = pf.project_id WHERE pf.name ILIKE $1 OR pf.tags::text ILIKE $1 ORDER BY pf.created_at DESC LIMIT 10',
      ['%' + query + '%']
    );

    if (docsR.rows.length === 0) {
      return sendMessage(chatId, '📁 "' + query + '" 검색 결과가 없습니다.');
    }

    var msg = '🔍 <b>문서 검색: ' + query + '</b>\n\n';
    docsR.rows.forEach(function (r, i) {
      var sizeStr = '';
      if (r.size) {
        var sizeKB = r.size / 1024;
        sizeStr = sizeKB >= 1024 ? (Math.round(sizeKB / 1024 * 10) / 10) + 'MB' : Math.round(sizeKB) + 'KB';
      }
      var dateStr = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '';
      msg += (i + 1) + '. ' + r.name + (r.ext ? '.' + r.ext : '');
      if (sizeStr) msg += ' (' + sizeStr + ')';
      if (dateStr) msg += ' ' + dateStr;
      if (r.project_name) msg += '\n   📁 ' + r.project_name;
      msg += '\n';
    });

    return sendMessage(chatId, msg);
  }

  return {
    cmdDocs: cmdDocs,
    cmdSearchDoc: cmdSearchDoc
  };
}

module.exports = { create: create };
