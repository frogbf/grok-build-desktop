import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DEFAULT_PROXY = 'https://cli-chat-proxy.grok.com/v1'
const TOKEN_HEADER = 'xai-grok-cli'

export type AccountBillingSnapshot = {
  creditUsagePercent: number | null
  periodStart: string | null
  periodEnd: string | null
  periodType: string | null
  productUsage: Array<{ product: string; usagePercent: number }>
  onDemandCap: number | null
  onDemandUsed: number | null
}

export type AccountSubscription = {
  ok: boolean
  authPresent: boolean
  email: string | null
  displayName: string | null
  userId: string | null
  /** Internal enum e.g. GrokPro */
  subscriptionTier: string | null
  /** User-facing e.g. SuperGrok */
  subscriptionDisplay: string | null
  hasGrokCodeAccess: boolean | null
  allowAccess: boolean | null
  /** Asset path e.g. users/…/profile-picture.webp */
  profileImageAssetId: string | null
  /** data: URL for renderer <img> (fetched with OAuth in main) */
  avatarDataUrl: string | null
  billing: AccountBillingSnapshot | null
  fetchedAt: number
  error?: string
}

const ASSET_SERVER = 'https://assets.grok.com'

type AuthEntry = {
  email?: string
  first_name?: string
  last_name?: string
  user_id?: string
  key?: string
  expires_at?: string
  profile_image_asset_id?: string
}

let avatarCache: { assetId: string; dataUrl: string } | null = null

function authPath(): string {
  return join(homedir(), '.grok', 'auth.json')
}

function readAuth(): { entry: AuthEntry | null; key: string | null } {
  const p = authPath()
  if (!existsSync(p)) return { entry: null, key: null }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, AuthEntry>
    const entry = Object.values(raw)[0]
    if (!entry?.key) return { entry: entry || null, key: null }
    return { entry, key: entry.key }
  } catch {
    return { entry: null, key: null }
  }
}

function proxyBase(): string {
  const fromEnv = process.env.GROK_CLI_CHAT_PROXY_BASE_URL?.trim()
  return (fromEnv || DEFAULT_PROXY).replace(/\/$/, '')
}

async function proxyGet(
  path: string,
  key: string,
): Promise<{ status: number; json: unknown; text: string }> {
  const url = `${proxyBase()}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      'X-XAI-Token-Auth': TOKEN_HEADER,
      Accept: 'application/json',
      'x-grok-client-version': 'grok-build-desktop',
    },
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // leave null
  }
  return { status: res.status, json, text }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v && typeof v === 'object' && 'val' in v) {
    const n = (v as { val?: unknown }).val
    if (typeof n === 'number' && Number.isFinite(n)) return n
  }
  return null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function parseBilling(json: unknown): AccountBillingSnapshot | null {
  const root = asRecord(json)
  const config = asRecord(root?.config)
  if (!config) return null
  const period = asRecord(config.currentPeriod)
  const productsRaw = config.productUsage
  const productUsage: AccountBillingSnapshot['productUsage'] = []
  if (Array.isArray(productsRaw)) {
    for (const p of productsRaw) {
      const pr = asRecord(p)
      if (!pr) continue
      const product = str(pr.product)
      const usagePercent = num(pr.usagePercent)
      if (product && usagePercent != null) productUsage.push({ product, usagePercent })
    }
  }
  return {
    creditUsagePercent: num(config.creditUsagePercent),
    periodStart: str(period?.start) || str(config.billingPeriodStart),
    periodEnd: str(period?.end) || str(config.billingPeriodEnd),
    periodType: str(period?.type),
    productUsage,
    onDemandCap: num(config.onDemandCap),
    onDemandUsed: num(config.onDemandUsed),
  }
}

/** Prefer node:https over undici fetch — assets.grok.com often hangs on undici connect. */
function httpsGetBuffer(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; ctype: string; buf: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'GET',
        headers,
        timeout: 15000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            ctype: String(res.headers['content-type'] || 'image/webp'),
            buf: Buffer.concat(chunks),
          })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', reject)
    req.end()
  })
}

async function fetchAvatarViaCurl(
  url: string,
  key: string,
): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileAsync(
      'curl',
      [
        '-fsSL',
        '--max-time',
        '15',
        '-H',
        `Authorization: Bearer ${key}`,
        '-H',
        `X-XAI-Token-Auth: ${TOKEN_HEADER}`,
        '-H',
        'Accept: image/*,*/*',
        url,
      ],
      {
        encoding: 'buffer',
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      },
    )
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
  } catch {
    return null
  }
}

async function fetchAvatarDataUrl(
  assetId: string | null,
  key: string,
): Promise<string | null> {
  if (!assetId) return null
  if (avatarCache?.assetId === assetId) return avatarCache.dataUrl
  const url = `${ASSET_SERVER}/${assetId.replace(/^\//, '')}`
  try {
    // curl first: node undici/https often hangs on assets.grok.com in some envs
    let buf = await fetchAvatarViaCurl(url, key)
    if (!buf || buf.length === 0) {
      try {
        const res = await httpsGetBuffer(url, {
          Authorization: `Bearer ${key}`,
          'X-XAI-Token-Auth': TOKEN_HEADER,
          Accept: 'image/*,*/*',
          'User-Agent': 'grok-build-desktop',
        })
        if (res.status >= 200 && res.status < 300 && res.buf.length > 0) {
          buf = res.buf
        }
      } catch {
        // ignore
      }
    }
    if (!buf || buf.length === 0) return null
    const ctype = buf[0] === 0x52 ? 'image/webp' : 'image/jpeg'
    const dataUrl = `data:${ctype};base64,${buf.toString('base64')}`
    avatarCache = { assetId, dataUrl }
    return dataUrl
  } catch {
    return null
  }
}

export async function fetchAccountSubscription(): Promise<AccountSubscription> {
  const empty = (partial: Partial<AccountSubscription>): AccountSubscription => ({
    ok: false,
    authPresent: false,
    email: null,
    displayName: null,
    userId: null,
    subscriptionTier: null,
    subscriptionDisplay: null,
    hasGrokCodeAccess: null,
    allowAccess: null,
    profileImageAssetId: null,
    avatarDataUrl: null,
    billing: null,
    fetchedAt: Date.now(),
    ...partial,
  })

  const { entry, key } = readAuth()
  if (!key) {
    return empty({
      authPresent: false,
      email: entry?.email || null,
      profileImageAssetId: entry?.profile_image_asset_id || null,
      error: 'not authenticated',
    })
  }

  const name = [entry?.first_name, entry?.last_name].filter(Boolean).join(' ').trim()

  try {
    const [userRes, billingRes, settingsRes] = await Promise.all([
      proxyGet('/user?include=subscription', key),
      proxyGet('/billing?format=credits', key),
      proxyGet('/settings', key),
    ])

    if (userRes.status === 401 || userRes.status === 403) {
      return empty({
        ok: false,
        authPresent: true,
        email: entry?.email || null,
        displayName: name || null,
        userId: entry?.user_id || null,
        profileImageAssetId: entry?.profile_image_asset_id || null,
        error: `auth expired or rejected (${userRes.status}) — run grok login`,
      })
    }

    const user = asRecord(userRes.json)
    const settings = asRecord(settingsRes.json)

    // API returns camelCase subscriptionTier when ?include=subscription
    const tier = str(user?.subscriptionTier) || str(user?.subscription_tier)

    const display =
      str(settings?.subscription_tier_display) ||
      str(settings?.subscriptionTierDisplay) ||
      null

    const billing =
      billingRes.status >= 200 && billingRes.status < 300
        ? parseBilling(billingRes.json)
        : null

    const profileImageAssetId =
      str(user?.profileImageAssetId) ||
      str(user?.profile_image_asset_id) ||
      entry?.profile_image_asset_id ||
      null

    const avatarDataUrl = await fetchAvatarDataUrl(profileImageAssetId, key)

    return {
      ok: userRes.status >= 200 && userRes.status < 300,
      authPresent: true,
      email: str(user?.email) || entry?.email || null,
      displayName:
        [str(user?.firstName), str(user?.lastName)].filter(Boolean).join(' ').trim() ||
        name ||
        null,
      userId: str(user?.userId) || str(user?.user_id) || entry?.user_id || null,
      subscriptionTier: tier,
      subscriptionDisplay: display,
      hasGrokCodeAccess:
        typeof user?.hasGrokCodeAccess === 'boolean' ? user.hasGrokCodeAccess : null,
      allowAccess: typeof settings?.allow_access === 'boolean' ? settings.allow_access : null,
      profileImageAssetId,
      avatarDataUrl,
      billing,
      fetchedAt: Date.now(),
      error:
        userRes.status >= 200 && userRes.status < 300
          ? undefined
          : `user HTTP ${userRes.status}`,
    }
  } catch (e) {
    return empty({
      ok: false,
      authPresent: true,
      email: entry?.email || null,
      displayName: name || null,
      userId: entry?.user_id || null,
      profileImageAssetId: entry?.profile_image_asset_id || null,
      error: String(e),
    })
  }
}
