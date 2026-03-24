function parsePagination(query, defaultLimit) {
  var raw = parseInt(query.limit, 10) || defaultLimit || 100;
  // all=true 요청 시 상한 50000 허용 (레거시 호환), 그 외 200
  var maxLimit = query.all === 'true' ? 50000 : 200;
  var limit = Math.min(raw, maxLimit);
  var offset = parseInt(query.offset, 10) || 0;
  return { limit: limit, offset: offset };
}
module.exports = { parsePagination: parsePagination };
