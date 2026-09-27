/**
 * http-errors.js — API 오류 응답 형식을 한 곳에서 만든다.
 *
 * 응답 본문 계약(클라이언트가 의존): { error: CODE, message?: string }
 *   - 클라이언트는 err.data.error 로 분기한다 — 예: 'NOT_FOUND'(project-data.js),
 *     'CONFLICT'(timeline.js), 'CREDIT_LOW' / 'AI_OVERLOADED'(archive-trend.js),
 *     'STORAGE_DISABLED'(document-manager.js). 코드·상태·메시지는 바꾸지 말 것.
 *   - message 가 없던 응답(예: { error: 'NOT_FOUND' })은 그대로 message 없이 보낸다.
 *
 * 사용:
 *   var httpErr = require('../lib/http-errors');
 *   return httpErr.sendError(res, 404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
 *   ...
 *   } catch (e) { httpErr.serverError(res, '[projects/list]', e); }
 */

var DEFAULT_500_MESSAGE = '서버 오류';

/**
 * @param {import('express').Response} res
 * @param {number} status   HTTP 상태
 * @param {string} code     기계 판독용 오류 코드 (예: 'NOT_FOUND')
 * @param {string} [message] 사용자 표시용 메시지. 생략하면 본문에 message 키 자체가 없음.
 * @param {object} [extra]  본문에 합칠 추가 필드 (예: { latest, yourVersion })
 */
function sendError(res, status, code, message, extra) {
  var body = { error: code };
  if (message !== undefined) body.message = message;
  if (extra) {
    for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
    }
  }
  return res.status(status).json(body);
}

/**
 * 서버 측에 상세 오류를 남기고, 클라이언트엔 일반화된 500 을 돌려준다.
 * (스택·SQL 메시지를 응답에 싣지 않는다.) 이미 응답을 보낸 뒤라면 로그만 남긴다.
 *
 * @param {import('express').Response} res
 * @param {string} tag       로그 태그 (예: '[projects/list]')
 * @param {Error} e
 * @param {string} [message] 기본 '서버 오류'. 기존 라우트가 쓰던 문구가 다르면 그대로 넘긴다.
 */
function serverError(res, tag, e, message) {
  console.error(tag, e);
  if (res.headersSent) return undefined;
  return sendError(res, 500, 'SERVER_ERROR', message === undefined ? DEFAULT_500_MESSAGE : message);
}

module.exports = {
  sendError: sendError,
  serverError: serverError,
  DEFAULT_500_MESSAGE: DEFAULT_500_MESSAGE
};
