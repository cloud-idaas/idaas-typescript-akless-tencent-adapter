import { CredentialException, type IDaaSException, isIDaaSException } from '@cloud-idaas/core-sdk';
import {
  type AklessProviderOptions,
  AklessProviderBuilder,
  CachedCloudCredentialProvider,
  type ExpiringCredential,
  credentialExpiration,
  credentialString,
} from '@cloud-idaas/pam-client-sdk';

/** Generic PAM STS snapshot; expiration is ISO 8601 and tmpSecret fields are renamed at the adapter boundary. */
export interface TencentSessionCredentials extends ExpiringCredential {
  secretId: string;
  secretKey: string;
  token: string;
}
/** Fields required by Tencent Cloud DynamicCredential.getCredential. */
export interface TencentCredential {
  secretId: string;
  secretKey: string;
  token: string;
}
/** Temporary credential callback data accepted by cos-nodejs-sdk-v5 3.0.0. */
export interface COSCredential {
  TmpSecretId: string;
  TmpSecretKey: string;
  SecurityToken: string;
  /** Zero means the server did not provide an issuance time; COS uses its default time policy. */
  StartTime: number;
  /** Unix seconds; local time must not extend the server-provided expiration. */
  ExpiredTime: number;
}
/**
 * Structural COS getAuthorization callback; starts no background I/O before credentials are requested.
 * @param options - Request context supplied by COS; currently unused by this adapter.
 * @param callback - Credential callback that must complete; COS has no separate error argument.
 */
export type COSGetAuthorization = (
  options: unknown,
  callback: (value: COSCredential) => void,
) => void;
/** COS callback created by an independent factory, with cleanup for the underlying provider. */
export interface COSAuthorizationProvider extends COSGetAuthorization {
  /** Closes owned PAM/HTTP resources, leaving the COS client and injected shared sources open. */
  close(): void;
}
/**
 * Provides Tencent Cloud DynamicCredential and COS beta integrations on Node.js 20/22/24.
 * @remarks The callback protocol was checked against cos-nodejs-sdk-v5 3.0.0. Inherited getCredentials returns
 * independent STS snapshots. close releases only provider-owned resources; injected PAM, HTTP, and
 * machine credential sources remain caller-owned.
 */
export class IDaaSPamTencentCloudCredentialsProvider extends CachedCloudCredentialProvider<TencentSessionCredentials> {
  /** @returns A configuration builder without I/O; STS retrieval starts on first use after build. */
  static builder(): AklessProviderBuilder<IDaaSPamTencentCloudCredentialsProvider> {
    return new AklessProviderBuilder(
      (options) => new IDaaSPamTencentCloudCredentialsProvider(options),
    );
  }
  /**
   * Creates a Tencent Cloud provider without fetching STS credentials.
   * @param options - Required role and optional PAM, HTTP, machine credential source, and cache configuration.
   * @throws ConfigException - The role or configuration is invalid, or the required default factory is not initialized.
   */
  constructor(options: AklessProviderOptions) {
    super(options, (response) => {
      const token = response.tencentCloudStsToken;
      if (!token)
        throw new CredentialException(
          'Response is missing tencentCloudStsToken',
          'InvalidCredentialResponse',
        );
      let expiration = credentialExpiration(response, token.expiration);
      if (token.expiredTime !== undefined) {
        if (typeof token.expiredTime !== 'number' || !Number.isFinite(token.expiredTime))
          throw new CredentialException('expiredTime is invalid', 'InvalidExpiration');
        expiration = Math.min(expiration, token.expiredTime * 1000);
        if (!Number.isFinite(expiration) || expiration <= Date.now())
          throw new CredentialException('expiredTime has expired', 'InvalidExpiration');
      }
      return {
        secretId: credentialString(token.tmpSecretId, 'tmpSecretId'),
        secretKey: credentialString(token.tmpSecretKey, 'tmpSecretKey'),
        token: credentialString(token.token, 'token'),
        expiration: new Date(expiration).toISOString(),
      };
    });
  }
  /**
   * Retrieves current credentials for the Tencent Cloud SDK.
   * @returns An independent secretId/secretKey/token snapshot.
   * @throws IDaaSException - Retrieval fails without usable unexpired cached credentials, or the provider is closed.
   */
  async getCredential(): Promise<TencentCredential> {
    const value = await this.getCredentials();
    this.assertAvailable(value);
    return { secretId: value.secretId, secretKey: value.secretKey, token: value.token };
  }
  /**
   * Retrieves COS temporary credentials without inventing a server issuance time.
   * @returns Independent callback data; ExpiredTime uses Unix seconds and StartTime=0 selects the COS default policy.
   * @throws IDaaSException - Retrieval or parsing fails, refresh fails after expiration, or the provider is closed.
   */
  async getCOSCredential(): Promise<COSCredential> {
    const value = await this.getCredentials();
    this.assertAvailable(value);
    return {
      TmpSecretId: value.secretId,
      TmpSecretKey: value.secretKey,
      SecurityToken: value.token,
      StartTime: 0,
      ExpiredTime: Math.floor(Date.parse(value.expiration) / 1000),
    };
  }
  /**
   * Creates a COS getAuthorization callback sharing this provider.
   * @param onError - Optional observer of classified errors; observer exceptions do not prevent COS request completion.
   * @returns A callback sharing the existing cache; the caller must still close this provider.
   * @remarks COS only has a success-data callback. Retrieval failures notify the observer and pass invalid credentials to
   * trigger the official argument-error path, avoiding hung requests without inventing a COS error argument.
   */
  toCOSGetAuthorization(onError?: (error: IDaaSException) => void): COSGetAuthorization {
    const report = (error: unknown) => {
      try {
        onError?.(
          isIDaaSException(error)
            ? error
            : new CredentialException(
                'COS credential retrieval failed',
                'CredentialRetrievalFailed',
              ),
        );
      } catch {
        /* Error observers must not prevent request completion. */
      }
    };
    return (_options, callback) => {
      const fail = (error: unknown) => {
        report(error);
        callback({
          TmpSecretId: '',
          TmpSecretKey: '',
          SecurityToken: '',
          StartTime: 0,
          ExpiredTime: 0,
        });
      };
      void this.getCOSCredential()
        .then((value) => {
          try {
            this.assertAvailable({ expiration: new Date(value.ExpiredTime * 1000).toISOString() });
          } catch (error) {
            fail(error);
            return;
          }
          callback(value);
        }, fail)
        .catch(report);
    };
  }
}
/**
 * Creates a Tencent Cloud DynamicCredential provider without immediately fetching STS credentials.
 * @param roleOrOptions - Role external ID or complete configuration including the role.
 * @param options - Additional configuration when the first argument is a string; injected sources take precedence.
 * @returns An independent provider; callers must close it after use, with owned and shared resources managed separately.
 * @throws ConfigException - The configuration is invalid or the required default factory is not initialized.
 */
export function createTencentCloudCredentialsProvider(
  roleOrOptions: string | AklessProviderOptions,
  options: Omit<AklessProviderOptions, 'roleExternalId'> = {},
): IDaaSPamTencentCloudCredentialsProvider {
  return new IDaaSPamTencentCloudCredentialsProvider(
    typeof roleOrOptions === 'string'
      ? { ...options, roleExternalId: roleOrOptions }
      : roleOrOptions,
  );
}
/**
 * Creates an independent dynamic credential callback for cos-nodejs-sdk-v5 3.0.0.
 * @param roleOrOptions - Role external ID or complete configuration.
 * @param options - Additional configuration when the first argument is a string.
 * @param onError - Optional classified-error observer; its exceptions are isolated and cannot prevent COS request completion.
 * @returns A callback with close; close after use without closing the COS client or shared injected resources.
 * @throws ConfigException - The configuration is invalid or the required default factory is not initialized.
 * @remarks Asynchronous retrieval failures complete through the observer and the COS invalid-credential error path.
 */
export function createTencentCloudCOSCredentialsProvider(
  roleOrOptions: string | AklessProviderOptions,
  options: Omit<AklessProviderOptions, 'roleExternalId'> = {},
  onError?: (error: IDaaSException) => void,
): COSAuthorizationProvider {
  const provider = createTencentCloudCredentialsProvider(roleOrOptions, options);
  const callback = provider.toCOSGetAuthorization(onError) as COSAuthorizationProvider;
  callback.close = () => provider.close();
  return callback;
}
/** Tencent Cloud beta convenience factories; do not create SDK or COS service clients. */
export class IDaaSPamAklessCredentialFactory {
  /** Arguments, errors, and resource ownership match the named general provider factory. */
  static createTencentCloudCredentialsProvider = createTencentCloudCredentialsProvider;
  /** Arguments, callback error handling, and close semantics match the named COS factory. */
  static createTencentCloudCOSCredentialsProvider = createTencentCloudCOSCredentialsProvider;
}
