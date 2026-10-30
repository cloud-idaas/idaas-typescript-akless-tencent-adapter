import { strict as assert } from 'node:assert';
import { IDaaSPamTencentCloudCredentialsProvider } from '../src';

describe('Tencent Cloud expiration fields', () => {
  it('uses the earlier Unix-second deadline when expiredTime precedes the parent and ISO deadlines', async () => {
    const early = Math.floor(Date.now() / 1000) + 1200;
    const later = early + 1800;
    const source = new IDaaSPamTencentCloudCredentialsProvider({
      roleExternalId: 'role',
      cache: { logger: { info() {}, warn() {}, error() {} } },
      pamClient: {
        async obtainAccessCredential() {
          return {
            accessCredentialExpiresAt: later,
            tencentCloudStsToken: {
              tmpSecretId: 'id',
              tmpSecretKey: 'key',
              token: 'session',
              expiration: new Date(later * 1000).toISOString(),
              expiredTime: early,
            },
          };
        },
      },
    });
    try {
      assert.equal(Date.parse((await source.getCredentials()).expiration), early * 1000);
    } finally {
      source.close();
    }
  });
});

describe('Beta regression: expiration and closure checks before cloud credential delivery', () => {
  it('invokes the failure callback once when closed between COS Promise completion and callback delivery', async () => {
    const source = new IDaaSPamTencentCloudCredentialsProvider({
      roleExternalId: 'role',
      pamClient: {
        async obtainAccessCredential() {
          return {};
        },
      },
    });
    source.getCOSCredential = async () => {
      queueMicrotask(() => source.close());
      return {
        TmpSecretId: 'id',
        TmpSecretKey: 'key',
        SecurityToken: 'session',
        StartTime: 0,
        ExpiredTime: Math.floor(Date.now() / 1000) + 3600,
      };
    };
    let callbacks = 0;
    let failures = 0;
    try {
      await new Promise<void>((resolve) => {
        source.toCOSGetAuthorization(() => {
          failures++;
        })({}, (value) => {
          callbacks++;
          assert.equal(value.TmpSecretId, '');
          assert.equal(value.ExpiredTime, 0);
          resolve();
        });
      });
      assert.equal(callbacks, 1);
      assert.equal(failures, 1);
    } finally {
      source.close();
    }
  });
  it('rejects delivery when credentials expire or the provider closes during the outer await', async () => {
    for (const transition of ['expire', 'close']) {
      for (const entry of ['generic', 'cos']) {
        let now = Date.now();
        const expiresAt = now + 3600000;
        const expiration = new Date(expiresAt).toISOString();
        const source = new IDaaSPamTencentCloudCredentialsProvider({
          roleExternalId: 'role',
          cache: { clock: () => now, logger: { info() {}, warn() {}, error() {} } },
          pamClient: {
            async obtainAccessCredential() {
              return {
                tencentCloudStsToken: {
                  tmpSecretId: 'id',
                  tmpSecretKey: 'key',
                  token: 'session',
                  expiration,
                },
              };
            },
          },
        });
        try {
          const valid = await source.getCredentials();
          const read =
            entry === 'generic' ? () => source.getCredential() : () => source.getCOSCredential();
          // Replace only the public credential source to isolate delivery races after the final await.
          source.getCredentials = async () => {
            queueMicrotask(() => {
              if (transition === 'close') source.close();
              else now = expiresAt;
            });
            return { ...valid };
          };
          await assert.rejects(read(), {
            errorCode: transition === 'close' ? 'Closed' : 'InvalidExpiration',
          });
        } finally {
          source.close();
        }
      }
    }
  });
});
