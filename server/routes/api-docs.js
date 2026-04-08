var express = require('express');
var router = express.Router();

var spec = {
  openapi: '3.0.0',
  info: {
    title: 'Work Manager API',
    version: '1.0.0',
    description: '업무 관리 플랫폼 API'
  },
  servers: [
    { url: '/api/v1', description: 'API v1' },
    { url: '/api', description: 'API (legacy, backward-compatible)' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          message: { type: 'string' }
        }
      }
    }
  },
  security: [{ bearerAuth: [] }],
  paths: {
    // ── Auth ──
    '/auth/login': {
      post: {
        summary: '로그인',
        tags: ['Auth'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: '로그인 성공 — JWT 토큰 반환' },
          '401': { description: '인증 실패' }
        }
      }
    },
    '/auth/register': {
      post: {
        summary: '회원가입',
        tags: ['Auth'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'name'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                  name: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: '회원가입 성공' },
          '409': { description: '이메일 중복' }
        }
      }
    },
    '/auth/refresh': {
      post: {
        summary: '토큰 갱신',
        tags: ['Auth'],
        responses: {
          '200': { description: '새 액세스 토큰 반환' },
          '401': { description: '리프레시 토큰 만료' }
        }
      }
    },

    // ── Projects ──
    '/projects': {
      get: {
        summary: '프로젝트 목록 조회',
        tags: ['Projects'],
        responses: {
          '200': { description: '프로젝트 배열 반환' }
        }
      },
      post: {
        summary: '프로젝트 생성',
        tags: ['Projects'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: '프로젝트 생성 성공' }
        }
      }
    },
    '/projects/{id}': {
      get: {
        summary: '프로젝트 상세 조회',
        tags: ['Projects'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: '프로젝트 상세 정보' },
          '404': { description: '프로젝트 없음' }
        }
      }
    },

    // ── Issues ──
    '/issues': {
      get: {
        summary: '이슈 목록 조회',
        tags: ['Issues'],
        parameters: [
          { name: 'projectId', in: 'query', schema: { type: 'string' }, description: '프로젝트 ID 필터' },
          { name: 'status', in: 'query', schema: { type: 'string' }, description: '상태 필터' }
        ],
        responses: {
          '200': { description: '이슈 배열 반환' }
        }
      },
      post: {
        summary: '이슈 생성',
        tags: ['Issues'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  projectId: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: '이슈 생성 성공' }
        }
      }
    },

    // ── Events ──
    '/events': {
      get: {
        summary: '일정 목록 조회',
        tags: ['Events'],
        parameters: [
          { name: 'start', in: 'query', schema: { type: 'string', format: 'date' }, description: '시작일' },
          { name: 'end', in: 'query', schema: { type: 'string', format: 'date' }, description: '종료일' }
        ],
        responses: {
          '200': { description: '일정 배열 반환' }
        }
      },
      post: {
        summary: '일정 생성',
        tags: ['Events'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'date'],
                properties: {
                  title: { type: 'string' },
                  date: { type: 'string', format: 'date' },
                  description: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: '일정 생성 성공' }
        }
      }
    },

    // ── Orders ──
    '/orders': {
      get: {
        summary: '발주 목록 조회',
        tags: ['Orders'],
        responses: {
          '200': { description: '발주 배열 반환' }
        }
      },
      post: {
        summary: '발주 생성',
        tags: ['Orders'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string' },
                  vendor: { type: 'string' },
                  amount: { type: 'number' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: '발주 생성 성공' }
        }
      }
    },

    // ── Records (Archives) ──
    '/archives/records': {
      get: {
        summary: '업무일지 조회',
        tags: ['Records'],
        parameters: [
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' }, description: '날짜 필터' }
        ],
        responses: {
          '200': { description: '업무일지 배열 반환' }
        }
      },
      post: {
        summary: '업무일지 저장',
        tags: ['Records'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  date: { type: 'string', format: 'date' },
                  content: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: '업무일지 저장 성공' }
        }
      }
    },

    // ── Billing ──
    '/billing/plans': {
      get: {
        summary: '요금제 목록 조회',
        tags: ['Billing'],
        security: [],
        responses: {
          '200': { description: '요금제 배열 반환' }
        }
      }
    },
    '/billing/subscription': {
      get: {
        summary: '현재 구독 정보 조회',
        tags: ['Billing'],
        responses: {
          '200': { description: '구독 정보 반환' }
        }
      }
    },
    '/billing/checkout': {
      post: {
        summary: '결제 세션 생성',
        tags: ['Billing'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['planId'],
                properties: {
                  planId: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: '결제 URL 반환' }
        }
      }
    }
  }
};

router.get('/', function (req, res) {
  res.json(spec);
});

module.exports = router;
