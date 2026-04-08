var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var config = require('../config');

// Stripe — optional dependency
var stripe;
try {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} catch (e) {
  console.warn('[billing] stripe 모듈이 설치되지 않았습니다. npm install stripe');
}

var WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// 플랜 매핑 (Stripe Price ID → 플랜 이름)
var PRICE_TO_PLAN = {};
if (process.env.STRIPE_PRICE_PRO) PRICE_TO_PLAN[process.env.STRIPE_PRICE_PRO] = 'pro';
if (process.env.STRIPE_PRICE_BUSINESS) PRICE_TO_PLAN[process.env.STRIPE_PRICE_BUSINESS] = 'business';
if (process.env.STRIPE_PRICE_ENTERPRISE) PRICE_TO_PLAN[process.env.STRIPE_PRICE_ENTERPRISE] = 'enterprise';

// ─── 헬퍼: 테넌트 정보 조회 ───
async function getTenant(userId) {
  var r = await db.query(
    'SELECT t.* FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE u.id = $1',
    [userId]
  );
  return r.rows[0] || null;
}

// ─── 헬퍼: 구독 이력 기록 ───
async function logSubscriptionEvent(tenantId, plan, event, stripeEventId, metadata) {
  await db.query(
    'INSERT INTO subscription_history (tenant_id, plan, event, stripe_event_id, metadata) VALUES ($1, $2, $3, $4, $5)',
    [tenantId, plan, event, stripeEventId || null, JSON.stringify(metadata || {})]
  );
}

// ═══════════════════════════════════════════
// Webhook — Stripe signature verification (NO auth, raw body)
// 이 엔드포인트는 app.js에서 express.json() 전에 express.raw()로 등록됨
// ═══════════════════════════════════════════
router.post('/webhook', async function (req, res) {
  if (!stripe) return res.status(501).json({ error: 'STRIPE_NOT_CONFIGURED' });

  var sig = req.headers['stripe-signature'];
  var event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (e) {
    console.error('[billing/webhook] Signature verification failed:', e.message);
    return res.status(400).json({ error: 'WEBHOOK_SIGNATURE_FAILED' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        var session = event.data.object;
        var tenantId = session.metadata && session.metadata.tenant_id;
        if (!tenantId) break;

        var priceId = null;
        // checkout session에서 price 정보 가져오기
        if (session.subscription) {
          var sub = await stripe.subscriptions.retrieve(session.subscription);
          priceId = sub.items.data[0] && sub.items.data[0].price.id;
        }

        var plan = PRICE_TO_PLAN[priceId] || 'pro';

        await db.query(
          'UPDATE tenants SET plan = $1, stripe_customer_id = $2, stripe_subscription_id = $3, billing_email = $4, updated_at = now() WHERE id = $5',
          [plan, session.customer, session.subscription, session.customer_email, tenantId]
        );

        await logSubscriptionEvent(tenantId, plan, 'checkout.completed', event.id, {
          customer: session.customer,
          subscription: session.subscription
        });
        break;
      }

      case 'customer.subscription.updated': {
        var sub = event.data.object;
        var priceId = sub.items.data[0] && sub.items.data[0].price.id;
        var plan = PRICE_TO_PLAN[priceId] || 'pro';

        var tr = await db.query(
          'SELECT id FROM tenants WHERE stripe_subscription_id = $1',
          [sub.id]
        );
        if (tr.rows.length) {
          var tenantId = tr.rows[0].id;
          await db.query(
            'UPDATE tenants SET plan = $1, plan_expires_at = $2, updated_at = now() WHERE id = $3',
            [plan, sub.current_period_end ? new Date(sub.current_period_end * 1000) : null, tenantId]
          );
          await logSubscriptionEvent(tenantId, plan, 'subscription.updated', event.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        var sub = event.data.object;
        var tr = await db.query(
          'SELECT id FROM tenants WHERE stripe_subscription_id = $1',
          [sub.id]
        );
        if (tr.rows.length) {
          var tenantId = tr.rows[0].id;
          await db.query(
            'UPDATE tenants SET plan = $1, stripe_subscription_id = NULL, plan_expires_at = NULL, updated_at = now() WHERE id = $2',
            ['free', tenantId]
          );
          await logSubscriptionEvent(tenantId, 'free', 'subscription.deleted', event.id);
        }
        break;
      }

      case 'invoice.payment_failed': {
        var invoice = event.data.object;
        console.warn('[billing/webhook] Payment failed for customer:', invoice.customer, 'invoice:', invoice.id);
        var tr = await db.query(
          'SELECT id FROM tenants WHERE stripe_customer_id = $1',
          [invoice.customer]
        );
        if (tr.rows.length) {
          await logSubscriptionEvent(tr.rows[0].id, 'unknown', 'payment.failed', event.id, {
            invoice_id: invoice.id,
            amount_due: invoice.amount_due
          });
        }
        break;
      }

      default:
        console.log('[billing/webhook] Unhandled event type:', event.type);
    }
  } catch (e) {
    console.error('[billing/webhook] Event processing error:', e);
    // Stripe expects 200 even on processing errors to avoid retries
  }

  res.json({ received: true });
});

// ═══════════════════════════════════════════
// 인증 필요 엔드포인트
// ═══════════════════════════════════════════
router.use(auth.authenticate);

// POST /api/billing/checkout — Stripe 결제 세션 생성
router.post('/checkout', async function (req, res) {
  if (!stripe) return res.status(501).json({ error: 'STRIPE_NOT_CONFIGURED', message: 'Stripe가 설정되지 않았습니다.' });

  try {
    var tenant = await getTenant(req.user.sub);
    if (!tenant) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '소속 테넌트가 없습니다.' });
    }

    var priceId = req.body.priceId;
    if (!priceId) {
      return res.status(400).json({ error: 'VALIDATION', message: 'priceId는 필수입니다.' });
    }

    var sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: (req.body.successUrl || process.env.STRIPE_SUCCESS_URL || (req.protocol + '://' + req.get('host') + '/?billing=success')),
      cancel_url: (req.body.cancelUrl || process.env.STRIPE_CANCEL_URL || (req.protocol + '://' + req.get('host') + '/?billing=cancel')),
      metadata: { tenant_id: tenant.id }
    };

    // 기존 Stripe customer가 있으면 재사용
    if (tenant.stripe_customer_id) {
      sessionParams.customer = tenant.stripe_customer_id;
    } else {
      sessionParams.customer_email = req.body.email || tenant.billing_email;
    }

    var session = await stripe.checkout.sessions.create(sessionParams);

    res.json({ data: { sessionId: session.id, url: session.url } });
  } catch (e) {
    console.error('[billing/checkout]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '결제 세션 생성 실패' });
  }
});

// POST /api/billing/portal — Stripe 고객 포탈 세션 생성
router.post('/portal', async function (req, res) {
  if (!stripe) return res.status(501).json({ error: 'STRIPE_NOT_CONFIGURED', message: 'Stripe가 설정되지 않았습니다.' });

  try {
    var tenant = await getTenant(req.user.sub);
    if (!tenant || !tenant.stripe_customer_id) {
      return res.status(400).json({ error: 'NO_SUBSCRIPTION', message: '활성 구독이 없습니다.' });
    }

    var session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: req.body.returnUrl || process.env.STRIPE_PORTAL_RETURN_URL || (req.protocol + '://' + req.get('host') + '/')
    });

    res.json({ data: { url: session.url } });
  } catch (e) {
    console.error('[billing/portal]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '포탈 세션 생성 실패' });
  }
});

// GET /api/billing/status — 현재 구독 상태 조회
router.get('/status', async function (req, res) {
  try {
    var tenant = await getTenant(req.user.sub);
    if (!tenant) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '소속 테넌트가 없습니다.' });
    }

    var data = {
      plan: tenant.plan || 'free',
      stripeCustomerId: tenant.stripe_customer_id || null,
      stripeSubscriptionId: tenant.stripe_subscription_id || null,
      planExpiresAt: tenant.plan_expires_at || null,
      billingEmail: tenant.billing_email || null
    };

    // Stripe에서 실시간 구독 상태 조회 (선택적)
    if (stripe && tenant.stripe_subscription_id) {
      try {
        var sub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
        data.subscriptionStatus = sub.status;
        data.currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
        data.cancelAtPeriodEnd = sub.cancel_at_period_end;
      } catch (e) {
        // Stripe 조회 실패해도 DB 데이터는 반환
        console.warn('[billing/status] Stripe 조회 실패:', e.message);
      }
    }

    res.json({ data: data });
  } catch (e) {
    console.error('[billing/status]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '구독 상태 조회 실패' });
  }
});

module.exports = router;
