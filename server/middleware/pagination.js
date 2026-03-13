function parsePagination(query, defaultLimit) {
  var limit = Math.min(parseInt(query.limit, 10) || defaultLimit || 100, 500);
  var offset = parseInt(query.offset, 10) || 0;
  return { limit: limit, offset: offset };
}
module.exports = { parsePagination: parsePagination };
