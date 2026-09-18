/**
 * Microsoft (MSA) account authentication, ported from HMCL's
 * `OAuth` + `MicrosoftService`. The Azure application client id is
 * deployment-specific and therefore configurable instead of hardcoded.
 */

const DEVICE_CODE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';

/** Same scope set HMCL requests. */
const SCOPE = 'XboxLive.signin offline_access';

/** Response from the device-code endpoint. */
export interface DeviceCodeGrant {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  /** Polling interval in seconds. */
  readonly interval: number;
  /** Total lifetime of the code in seconds. */
  readonly expiresIn: number;
}

/** Token exchange outcome while polling the device-code grant. */
export type DeviceCodePollResult =
  | { readonly status: 'pending' }
  | { readonly status: 'slow-down' }
  | { readonly status: 'expired' }
  | {
      readonly status: 'done';
      readonly accessToken: string;
      readonly refreshToken: string;
    };

/** A signed-in Minecraft profile obtained through Xbox Live. */
export interface MinecraftSession {
  readonly accessToken: string;
  /** Epoch millis when the Minecraft access token expires. */
  readonly expiresAt: number;
  readonly profile: {
    readonly id: string;
    readonly name: string;
  };
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Microsoft OAuth 返回了无法解析的内容 (HTTP ${String(response.status)})`);
  }
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Xbox 认证返回了无法解析的内容 (HTTP ${String(response.status)})`);
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Step 1 of the device flow: obtain the code the user must enter. */
export async function requestDeviceCode(clientId: string): Promise<DeviceCodeGrant> {
  const json = await postForm(DEVICE_CODE_URL, { client_id: clientId, scope: SCOPE });
  if (!str(json.device_code)) {
    throw new Error(`获取设备码失败:${str(json.error_description) || str(json.error) || '未知错误'}`);
  }
  return {
    deviceCode: str(json.device_code),
    userCode: str(json.user_code),
    verificationUri: str(json.verification_uri),
    interval: typeof json.interval === 'number' ? json.interval : 5,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 900
  };
}

/** Step 2: poll the token endpoint once with the pending device code. */
export async function pollDeviceCodeToken(
  clientId: string,
  deviceCode: string
): Promise<DeviceCodePollResult> {
  const json = await postForm(TOKEN_URL, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    code: deviceCode,
    client_id: clientId
  });
  switch (str(json.error)) {
    case '':
      break;
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      return { status: 'slow-down' };
    case 'expired_token':
      return { status: 'expired' };
    default:
      throw new Error(str(json.error_description) || str(json.error));
  }
  const accessToken = str(json.access_token);
  const refreshToken = str(json.refresh_token);
  if (!accessToken || !refreshToken) throw new Error('微软登录响应缺少令牌');
  return { status: 'done', accessToken, refreshToken };
}

/** Exchanges a refresh token for a fresh live access token pair. */
export async function refreshLiveToken(
  clientId: string,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const json = await postForm(TOKEN_URL, {
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  const accessToken = str(json.access_token);
  if (!accessToken) {
    throw new Error(`刷新微软令牌失败:${str(json.error_description) || str(json.error) || '未知错误'}`);
  }
  return { accessToken, refreshToken: str(json.refresh_token) || refreshToken };
}

interface XstsResponse {
  token?: string;
  DisplayClaims?: { xui?: Array<{ uhs?: string }> };
}

/**
 * Steps 3-6: XBL → XSTS → Minecraft → profile, exactly following HMCL's
 * `authenticateViaLiveAccessToken`.
 */
export async function authenticateWithXbox(liveAccessToken: string): Promise<MinecraftSession> {
  const xbl = (await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${liveAccessToken}`
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  })) as XstsResponse;
  const uhs = xbl.DisplayClaims?.xui?.[0]?.uhs;
  if (!xbl.token || !uhs) throw new Error('Xbox Live 认证失败');

  const xsts = (await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  })) as XstsResponse & { XErr?: number };
  const xstsUhs = xsts.DisplayClaims?.xui?.[0]?.uhs;
  if (!xsts.token || !xstsUhs) {
    // XErr 2148916233 etc. mean "no Xbox account"; surface generically.
    throw new Error(
      xsts.XErr !== undefined ? `Xbox 授权被拒绝 (XErr ${xsts.XErr})` : 'XSTS 授权失败'
    );
  }

  const mcLogin = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.token}`
  });
  const mcToken = str(mcLogin.access_token);
  if (!mcToken) throw new Error('Minecraft 服务登录失败');

  // Ownership check (see HMCL GitHub#2979).
  const entitlements = await fetch('https://api.minecraftservices.com/entitlements/mcstore', {
    headers: { Authorization: `Bearer ${mcToken}` }
  });
  if (!entitlements.ok) {
    throw new Error(`验证游戏所有权失败 (HTTP ${String(entitlements.status)}),该账号可能未购买 Minecraft`);
  }

  const profileResponse = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mcToken}` }
  });
  if (!profileResponse.ok) {
    throw new Error(`获取玩家档案失败 (HTTP ${String(profileResponse.status)})`);
  }
  const profile = (await profileResponse.json()) as { id?: string; name?: string };
  if (!profile.id || !profile.name) throw new Error('玩家档案缺少 id 或名称');

  const expiresIn = typeof mcLogin.expires_in === 'number' ? mcLogin.expires_in : 86400;
  return {
    accessToken: mcToken,
    expiresAt: Date.now() + expiresIn * 1000,
    profile: { id: profile.id, name: profile.name }
  };
}
