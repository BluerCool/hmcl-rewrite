/**
 * Account store: persists accounts to `accounts.json` under the user data
 * directory and provides the Microsoft login orchestration used by IPC.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  authenticateWithXbox,
  pollDeviceCodeToken,
  refreshLiveToken,
  requestDeviceCode,
  type DeviceCodeGrant,
  type MinecraftSession
} from './microsoft.js';
import { offlineUuid } from '../launch/auth.js';

/** A launcher account (offline or Microsoft). */
export interface Account {
  /** Stable internal identifier. */
  readonly id: string;
  readonly kind: 'offline' | 'microsoft';
  username: string;
  uuid?: string;
  /** Microsoft-only session fields. */
  liveRefreshToken?: string;
  minecraftAccessToken?: string;
  minecraftExpiresAt?: number;
}

/** Serialized shape of `accounts.json`. */
interface AccountStoreFile {
  accounts: Account[];
}

/** Callbacks used while a device-code login is in flight. */
export interface MicrosoftLoginCallbacks {
  onDeviceCode(grant: DeviceCodeGrant): void;
  onSuccess(account: Account): void;
  onError(message: string): void;
}

const MAX_POLL_SECONDS = 900;

export class AccountStore {
  private accounts: Account[] = [];
  private polling = false;
  private cancelled = false;

  constructor(private readonly filePath: string) {}

  /** Loads `accounts.json`; missing or malformed files yield an empty store. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AccountStoreFile>;
      this.accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    } catch {
      this.accounts = [];
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify({ accounts: this.accounts } satisfies AccountStoreFile, null, 2),
      'utf8'
    );
  }

  list(): readonly Account[] {
    return this.accounts;
  }

  find(id: string): Account | undefined {
    return this.accounts.find((account) => account.id === id);
  }

  /** Creates an offline account with an optional custom UUID (vanilla-derived when omitted). */
  async addOffline(username: string, customUuid?: string): Promise<Account> {
    if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
      throw new Error('离线用户名只能包含字母、数字、下划线，长度 1-16');
    }
    const uuid = customUuid !== undefined && customUuid.length > 0 ? customUuid : offlineUuid(username);
    const existing = this.accounts.find(
      (account) => account.kind === 'offline' && account.uuid === uuid
    );
    if (existing) return existing;
    const account: Account = {
      id: randomUUID(),
      kind: 'offline',
      username,
      uuid
    };
    this.accounts.push(account);
    await this.save();
    return account;
  }

  async remove(id: string): Promise<void> {
    this.accounts = this.accounts.filter((account) => account.id !== id);
    await this.save();
  }

  /** Renames an offline account; the underlying uuid is kept so auth stays stable. */
  async rename(id: string, username: string): Promise<Account> {
    if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
      throw new Error('离线用户名只能包含字母、数字、下划线，长度 1-16');
    }
    const account = this.find(id);
    if (account === undefined) throw new Error('账户不存在');
    if (account.kind !== 'offline') throw new Error('仅支持重命名离线账户');
    account.username = username;
    await this.save();
    return account;
  }

  /**
   * Runs the Microsoft device-code flow. Resolves with the new account;
   * progress is reported through `callbacks`.
   */
  async addMicrosoft(clientId: string, callbacks: MicrosoftLoginCallbacks): Promise<Account> {
    if (!clientId) throw new Error('未配置 Azure 客户端 ID（请在设置中填写）');
    if (this.polling) throw new Error('已有微软登录正在进行');

    this.polling = true;
    this.cancelled = false;
    try {
      const grant = await requestDeviceCode(clientId);
      callbacks.onDeviceCode(grant);

      const deadline = Date.now() + Math.min(grant.expiresIn, MAX_POLL_SECONDS) * 1000;
      let interval = Math.max(grant.interval, 1) * 1000;
      for (;;) {
        if (this.cancelled) throw new Error('已取消登录');
        if (Date.now() > deadline) throw new Error('登录超时，请重试');

        await new Promise((resolve) => setTimeout(resolve, interval));
        if (this.cancelled) throw new Error('已取消登录');

        const poll = await pollDeviceCodeToken(clientId, grant.deviceCode);
        if (poll.status === 'pending') continue;
        if (poll.status === 'slow-down') {
          interval += 5000;
          continue;
        }
        if (poll.status === 'expired') throw new Error('设备码已过期，请重新登录');

        const session: MinecraftSession = await authenticateWithXbox(poll.accessToken);
        const account: Account = {
          id: randomUUID(),
          kind: 'microsoft',
          username: session.profile.name,
          uuid: session.profile.id,
          liveRefreshToken: poll.refreshToken,
          minecraftAccessToken: session.accessToken,
          minecraftExpiresAt: session.expiresAt
        };
        this.accounts.push(account);
        await this.save();
        callbacks.onSuccess(account);
        return account;
      }
    } catch (reason) {
      callbacks.onError(String(reason instanceof Error ? reason.message : reason));
      throw reason;
    } finally {
      this.polling = false;
      this.cancelled = false;
    }
  }

  cancelMicrosoftLogin(): void {
    if (this.polling) this.cancelled = true;
  }

  /**
   * Returns playable credentials, refreshing the Microsoft token when it
   * expires within a minute.
   */
  async getCredentials(
    account: Account,
    clientId: string
  ): Promise<{ username: string; uuid: string; accessToken: string; userType: string }> {
    if (account.kind === 'offline') {
      return {
        username: account.username,
        uuid: account.uuid ?? offlineUuid(account.username),
        accessToken: randomUUID().replaceAll('-', ''),
        userType: 'legacy'
      };
    }

    let token = account.minecraftAccessToken;
    if (
      !token ||
      account.minecraftExpiresAt === undefined ||
      Date.now() > account.minecraftExpiresAt - 60_000
    ) {
      if (!clientId) throw new Error('微软账号令牌过期且未配置 Azure 客户端 ID，无法刷新');
      if (!account.liveRefreshToken) throw new Error('缺少刷新令牌，请重新登录微软账号');
      const refreshed = await refreshLiveToken(clientId, account.liveRefreshToken);
      const session = await authenticateWithXbox(refreshed.accessToken);
      account.liveRefreshToken = refreshed.refreshToken;
      account.minecraftAccessToken = session.accessToken;
      account.minecraftExpiresAt = session.expiresAt;
      account.username = session.profile.name;
      account.uuid = session.profile.id;
      await this.save();
      token = session.accessToken;
    }
    return {
      username: account.username,
      uuid: account.uuid ?? '',
      accessToken: token ?? '',
      userType: 'msa'
    };
  }
}
