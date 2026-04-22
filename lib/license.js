// ========================================
// Recording Pro — ライセンス管理モジュール
// ========================================

const API_BASE = 'https://server-bice-omega.vercel.app';

const PLAN_FEATURES = {
  free: { maxMinutes: 25, drive: false, ai: false, staff: false },
  pro:  { maxMinutes: 60, drive: true,  ai: true,  staff: true  },
  team: { maxMinutes: 60, drive: true,  ai: true,  staff: true  }
};

const CACHE_TTL = 24 * 60 * 60 * 1000;       // 24時間
const GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7日

/**
 * ライセンスキーをAPIで検証し、結果をstorageに保存
 */
export async function validateLicense(key) {
  try {
    const res = await fetch(`${API_BASE}/api/license/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    if (!res.ok) {
      return { valid: false, error: `API error: ${res.status}` };
    }
    const data = await res.json();

    if (data.valid) {
      const plan = data.plan || 'pro';
      const features = PLAN_FEATURES[plan] || PLAN_FEATURES.pro;
      await chrome.storage.local.set({
        licenseKey: key,
        plan,
        planFeatures: features,
        licenseExpiresAt: data.expiresAt || null,
        lastValidated: Date.now()
      });
      return { valid: true, plan, features, expiresAt: data.expiresAt };
    }

    return { valid: false, error: data.error || 'Invalid license key' };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * storageからライセンス状態を読み取り（キャッシュベース）
 */
export async function getLicenseStatus() {
  const data = await chrome.storage.local.get([
    'licenseKey', 'plan', 'planFeatures', 'licenseExpiresAt', 'lastValidated'
  ]);

  if (!data.licenseKey) {
    return { plan: 'free', features: PLAN_FEATURES.free };
  }

  const now = Date.now();
  const age = now - (data.lastValidated || 0);

  // キャッシュ有効（24時間以内）
  if (age < CACHE_TTL) {
    return {
      plan: data.plan || 'free',
      features: data.planFeatures || PLAN_FEATURES.free,
      expiresAt: data.licenseExpiresAt
    };
  }

  // グレースピリオド内 → キャッシュを信頼しつつバックグラウンド再検証
  if (age < GRACE_PERIOD) {
    validateLicense(data.licenseKey).catch(() => {});
    return {
      plan: data.plan || 'free',
      features: data.planFeatures || PLAN_FEATURES.free,
      expiresAt: data.licenseExpiresAt,
      stale: true
    };
  }

  // グレースピリオド超過 → Freeに降格
  await deactivateLicense();
  return { plan: 'free', features: PLAN_FEATURES.free, expired: true };
}

/**
 * ライセンスキーを認証して保存
 */
export async function activateLicense(key) {
  return await validateLicense(key);
}

/**
 * ライセンスを解除してFreeに戻す
 */
export async function deactivateLicense() {
  await chrome.storage.local.remove([
    'licenseKey', 'plan', 'planFeatures', 'licenseExpiresAt', 'lastValidated'
  ]);
}

/**
 * Pro以上かどうかの簡易チェック
 */
export async function isPro() {
  const { plan } = await getLicenseStatus();
  return plan === 'pro' || plan === 'team';
}

/**
 * プラン別の機能マップを取得
 */
export function getPlanFeatures(plan) {
  return PLAN_FEATURES[plan] || PLAN_FEATURES.free;
}
